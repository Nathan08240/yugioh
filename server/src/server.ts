import { randomInt } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./auth.ts";
import { cardInfo } from "./cards.ts";
import { dbDeckStore, deckReply, isDeckMessage, validDeckMessage, type DeckMessage, type DeckStore } from "./collection.ts";
import { activeDeck, createProfile, findProfile, openDb, type Db, type Profile } from "./db.ts";
import { openDuel, STARTING_LP, type Seed } from "./duel.ts";
import { isAllowed, POOL } from "./pool.ts";
import type { CardInfo, ClientMessage, Seat, ServerMessage } from "./protocol.ts";
import { chooseStarter, starterCards, type Starter } from "./starter.ts";
import { hideCards, visibleTo } from "./visibility.ts";

type Question = Extract<OcgMessage, { player: number }>;
type Player = { id: string; socket?: WebSocket; log: OcgMessage[]; deck: number[] };
export type Room = {
  code: string;
  players: Player[];
  duel?: Awaited<ReturnType<typeof openDuel>>;
  question?: Question;
  timer?: NodeJS.Timeout;
};

// Identity, profile and deck storage, faked in tests.
export type Accounts = DeckStore & {
  verify: (token: string) => Promise<string | null>;
  findProfile: (userId: string) => Promise<Profile | undefined>;
  // Resolves to undefined when the pseudo is already taken.
  createProfile: (userId: string, pseudo: string) => Promise<Profile | undefined>;
  activeDeck: (userId: string) => Promise<number[] | undefined>;
  // Resolves to false when the player already has an active deck.
  chooseStarter: (userId: string, starter: Starter) => Promise<boolean>;
};

export function dbAccounts(db: Db): Accounts {
  return {
    verify: (token) => verifySession(token),
    findProfile: (userId) => findProfile(db, userId),
    createProfile: (userId, pseudo) =>
      createProfile(db, userId, pseudo).catch((error: unknown) => {
        if (error instanceof postgres.PostgresError && error.code === "23505") return undefined;
        throw error;
      }),
    activeDeck: (userId) => activeDeck(db, userId),
    chooseStarter: (userId, starter) => chooseStarter(db, userId, starter),
    ...dbDeckStore(db),
  };
}

const PSEUDO = /^[A-Za-z0-9_-]{3,20}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;

// Response type the engine expects for each of its questions.
const ANSWERS = new Map<OcgMessageType, OcgResponseType>([
  [OcgMessageType.SELECT_BATTLECMD, OcgResponseType.SELECT_BATTLECMD],
  [OcgMessageType.SELECT_IDLECMD, OcgResponseType.SELECT_IDLECMD],
  [OcgMessageType.SELECT_EFFECTYN, OcgResponseType.SELECT_EFFECTYN],
  [OcgMessageType.SELECT_YESNO, OcgResponseType.SELECT_YESNO],
  [OcgMessageType.SELECT_OPTION, OcgResponseType.SELECT_OPTION],
  [OcgMessageType.SELECT_CARD, OcgResponseType.SELECT_CARD],
  [OcgMessageType.SELECT_CHAIN, OcgResponseType.SELECT_CHAIN],
  [OcgMessageType.SELECT_PLACE, OcgResponseType.SELECT_PLACE],
  [OcgMessageType.SELECT_POSITION, OcgResponseType.SELECT_POSITION],
  [OcgMessageType.SELECT_TRIBUTE, OcgResponseType.SELECT_TRIBUTE],
  [OcgMessageType.SORT_CHAIN, OcgResponseType.SORT_CARD],
  [OcgMessageType.SELECT_COUNTER, OcgResponseType.SELECT_COUNTER],
  [OcgMessageType.SELECT_SUM, OcgResponseType.SELECT_SUM],
  [OcgMessageType.SELECT_DISFIELD, OcgResponseType.SELECT_DISFIELD],
  [OcgMessageType.SORT_CARD, OcgResponseType.SORT_CARD],
  [OcgMessageType.SELECT_UNSELECT_CARD, OcgResponseType.SELECT_UNSELECT_CARD],
  [OcgMessageType.ROCK_PAPER_SCISSORS, OcgResponseType.ROCK_PAPER_SCISSORS],
  [OcgMessageType.ANNOUNCE_RACE, OcgResponseType.ANNOUNCE_RACE],
  [OcgMessageType.ANNOUNCE_ATTRIB, OcgResponseType.ANNOUNCE_ATTRIB],
  [OcgMessageType.ANNOUNCE_CARD, OcgResponseType.ANNOUNCE_CARD],
  [OcgMessageType.ANNOUNCE_NUMBER, OcgResponseType.ANNOUNCE_NUMBER],
]);

const imageFile = (code: number) => join(import.meta.dirname, "..", "vendor", "images", `${code}.jpg`);
const IMAGE_URL = /^\/api\/images\/(\d{1,10})\.jpg$/;
let cards: [number, Omit<CardInfo, "image">][] | undefined;

// Card data and images for the client (see CardInfo). Images are optional: `pnpm images` downloads them.
function serveHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && req.url === "/api/cards") {
    cards ??= [...POOL].flatMap((code) => {
      const info = cardInfo(code);
      return info ? [[code, info] as const] : [];
    });
    const body = Object.fromEntries(cards.map(([code, info]) => [code, { ...info, image: existsSync(imageFile(code)) } satisfies CardInfo]));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  if (req.method === "GET" && req.url === "/api/starters") {
    const body = { yugi: starterCards("yugi"), kaiba: starterCards("kaiba") };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  const code = Number(IMAGE_URL.exec(req.url ?? "")?.[1]);
  if (req.method === "GET" && POOL.has(code) && existsSync(imageFile(code))) {
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=86400" });
    createReadStream(imageFile(code)).pipe(res);
    return;
  }
  res.writeHead(404).end();
}

export const randomSeed = (): Seed => [...crypto.getRandomValues(new BigUint64Array(4))] as Seed;

function send(socket: WebSocket | undefined, data: ServerMessage) {
  socket?.send(JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function parse(data: string): ClientMessage | undefined {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof msg !== "object" || msg === null) return undefined;
  const valid =
    (msg.type === "auth" && typeof msg.token === "string" && msg.token.length <= 4096) ||
    (msg.type === "pseudo" && typeof msg.pseudo === "string") ||
    (msg.type === "starter" && (msg.starter === "yugi" || msg.starter === "kaiba")) ||
    msg.type === "create" ||
    (msg.type === "join" && typeof msg.room === "string") ||
    (msg.type === "respond" && typeof msg.response === "object" && msg.response !== null) ||
    validDeckMessage(msg);
  return valid ? (msg as ClientMessage) : undefined;
}

function ask(room: Room, retry: boolean) {
  const question = room.question;
  if (question) send(room.players[question.player]?.socket, { type: "question", question: hideCards(question, question.player), retry });
}

function broadcast(room: Room, messages: OcgMessage[]) {
  room.players.forEach((player, seat) => {
    const visible = messages.flatMap((msg) => visibleTo(msg, seat) ?? []);
    if (visible.length === 0) return;
    player.log.push(...visible);
    send(player.socket, { type: "messages", messages: visible });
  });
}

function endDuel(room: Room) {
  room.duel?.lib.destroyDuel(room.duel.handle);
  room.duel = undefined;
  room.question = undefined;
}

// Runs the engine until it asks a question or the duel ends. A crash inside the engine closes only this room.
export function advance(room: Room) {
  if (!room.duel) return;
  const { lib, handle } = room.duel;
  for (;;) {
    let status: OcgProcessResult;
    let messages: OcgMessage[];
    try {
      status = lib.duelProcess(handle);
      messages = lib.duelGetMessage(handle);
    } catch (error) {
      console.error(`[salle ${room.code}] erreur moteur : ${error}`);
      room.players.forEach((player) => send(player.socket, { type: "duel_error", error: "le moteur a rencontré une erreur, salle fermée" }));
      endDuel(room);
      return;
    }
    if (messages.some((msg) => msg.type === OcgMessageType.RETRY)) {
      ask(room, true);
      return;
    }
    const events = messages.filter((msg) => !ANSWERS.has(msg.type));
    // The engine keeps sending WIN without ever reaching END: the first one closes the duel.
    const win = events.findIndex((msg) => msg.type === OcgMessageType.WIN);
    broadcast(room, win === -1 ? events : events.slice(0, win + 1));
    if (win !== -1 || status === OcgProcessResult.END) {
      endDuel(room);
      return;
    }
    const last = messages.at(-1);
    if (status === OcgProcessResult.WAITING && last && "player" in last) {
      room.question = last;
      ask(room, false);
      return;
    }
  }
}

// Returns an error for the sender, if any. A response the engine cannot take is asked again.
function answer(room: Room, seat: Seat, response: OcgResponse): string | undefined {
  const question = room.question;
  if (!room.duel || question?.player !== seat) return "aucune question en attente";
  try {
    if (response.type !== ANSWERS.get(question.type)) throw new Error("type de réponse inattendu");
    room.duel.lib.duelSetResponse(room.duel.handle, response);
  } catch {
    ask(room, true);
    return undefined;
  }
  advance(room);
  return undefined;
}

async function start(room: Room, seed: Seed) {
  const decks = room.players.map((player) => player.deck);
  room.duel = await openDuel(seed, decks, (text) => console.error(`[salle ${room.code}] ${text}`));
  advance(room);
}

function newCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// A deck as validated for a duel: 40 to 60 cards, all from the allowed pool.
const validDeck = (deck: number[]) => deck.length >= 40 && deck.length <= 60 && deck.every(isAllowed);

export function startServer(port: number, accounts: Accounts, newSeed = randomSeed): WebSocketServer {
  const rooms = new Map<string, Room>();
  const http = createServer(serveHttp);
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);

  function sit(room: Room, id: string, socket: WebSocket, deck: number[]): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const isNew = known === -1;
    const seat = (isNew ? room.players.push({ id, log: [], deck }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    const decks: [number, number] = [room.players[0]?.deck.length ?? 0, room.players[1]?.deck.length ?? 0];
    send(socket, { type: "joined", room: room.code, seat, lp: STARTING_LP, decks, log: player.log });
    // The host's first `joined` guessed the guest's deck size as 0: correct it once they arrive.
    if (isNew && seat === 1) {
      const host = room.players[0];
      send(host.socket, { type: "joined", room: room.code, seat: 0, lp: STARTING_LP, decks, log: host.log });
    }
    if (room.question?.player === seat) ask(room, false);
    if (isNew && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function leave(room: Room, socket: WebSocket) {
    const player = room.players.find((seated) => seated.socket === socket);
    if (player) player.socket = undefined;
    if (room.players.some((player) => player.socket)) return;
    room.timer = setTimeout(() => {
      endDuel(room);
      rooms.delete(room.code);
    }, ROOM_TTL).unref();
  }

  wss.on("connection", (socket) => {
    let user: { id: string; pseudo?: string } | undefined;
    let seat: { room: Room; index: Seat } | undefined;
    // Messages are handled one at a time, so an action sent right after `auth` waits for its verification.
    let queue = Promise.resolve();

    async function identify(token: string): Promise<string | undefined> {
      if (user) return "déjà authentifié";
      const id = await accounts.verify(token);
      if (!id) return "jeton invalide";
      const profile = await accounts.findProfile(id);
      user = { id, pseudo: profile?.pseudo };
      send(socket, { type: "profile", pseudo: user.pseudo ?? null, needsStarter: profile !== undefined && profile.activeDeckId === null });
      return undefined;
    }

    async function choosePseudo(player: { id: string; pseudo?: string }, pseudo: string): Promise<string | undefined> {
      if (player.pseudo) return "pseudo déjà choisi";
      if (!PSEUDO.test(pseudo)) return "pseudo invalide : 3 à 20 caractères, lettres sans accent, chiffres, _ ou -";
      const profile = await accounts.createProfile(player.id, pseudo);
      if (!profile) return "pseudo déjà pris";
      player.pseudo = profile.pseudo;
      send(socket, { type: "profile", pseudo: profile.pseudo, needsStarter: profile.activeDeckId === null });
      return undefined;
    }

    async function pickStarter(player: { id: string; pseudo?: string }, starter: Starter): Promise<string | undefined> {
      const chosen = await accounts.chooseStarter(player.id, starter);
      if (!chosen) return "starter déjà choisi";
      send(socket, { type: "profile", pseudo: player.pseudo ?? null, needsStarter: false });
      return undefined;
    }

    async function enterRoom(player: { id: string }, msg: Extract<ClientMessage, { type: "create" } | { type: "join" }>): Promise<string | undefined> {
      const deck = await accounts.activeDeck(player.id);
      if (!deck) return "deck actif requis";
      if (!validDeck(deck)) return "deck actif invalide";
      const room = msg.type === "create" ? { code: newCode(rooms), players: [] } : rooms.get(msg.room.toUpperCase());
      if (!room) return "salle introuvable";
      rooms.set(room.code, room);
      const index = sit(room, player.id, socket, deck);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      return undefined;
    }

    async function manageDecks(player: { id: string }, msg: DeckMessage): Promise<string | undefined> {
      const reply = await deckReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    // Returns an error for the sender, if any.
    function handle(msg: ClientMessage): string | undefined | Promise<string | undefined> {
      if (msg.type === "auth") return identify(msg.token);
      if (!user) return "non authentifié";
      if (msg.type === "pseudo") return choosePseudo(user, msg.pseudo);
      if (!user.pseudo) return "pseudo à choisir d'abord";
      if (msg.type === "starter") return pickStarter(user, msg.starter);
      if (isDeckMessage(msg)) return manageDecks(user, msg);
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (seat) return "déjà dans une salle";
      return enterRoom(user, msg);
    }

    socket.on("close", () => {
      if (seat) leave(seat.room, socket);
    });
    socket.on("message", (data) => {
      queue = queue.then(async () => {
        if (socket.readyState !== socket.OPEN) return;
        const msg = parse(String(data));
        let error: string | undefined;
        try {
          error = msg ? await handle(msg) : "message invalide";
        } catch (failure) {
          console.error(failure);
          error = "service indisponible, réessayer plus tard";
        }
        if (error) send(socket, { type: "error", error });
      });
    });
  });
  return wss;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  startServer(port, dbAccounts(openDb()));
  console.log(`Serveur de partie sur http://localhost:${port} (WebSocket et /api)`);
}
