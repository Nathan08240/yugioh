import { randomInt } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./auth.ts";
import { Bot } from "./bot.ts";
import { cardInfo } from "./cards.ts";
import { createProfile, findProfile, openDb, type Db, type Profile } from "./db.ts";
import { KAIBA, YUGI } from "./decks.ts";
import { agreeToRules, openDuel, STANDARD_RULES, type Rules, type Seed } from "./duel.ts";
import { POOL } from "./pool.ts";
import type { CardInfo, ClientMessage, Rewards, Seat, ServerMessage } from "./protocol.ts";
import { respond } from "./respond.ts";
import { completeDuel, completedDuels, isUnlocked, STORY, STORY_DUELS, storyDeck, storyRules, storyView, type StoryDuel } from "./story.ts";
import { hideCards, visibleTo } from "./visibility.ts";

type Question = Extract<OcgMessage, { player: number }>;
type Player = { id: string; socket?: WebSocket; log: OcgMessage[]; bot?: Bot };
type Setup = { decks: [readonly number[], readonly number[]]; rules: Rules };
export type Room = {
  code: string;
  players: Player[];
  // ONLINE when absent.
  setup?: Setup;
  duel?: Awaited<ReturnType<typeof openDuel>>;
  question?: Question;
  timer?: NodeJS.Timeout;
  onWin?: (winner: number) => void;
};

// ponytail: every online duel is Yugi (host) vs Kaiba until the deck builder exists.
const ONLINE: Setup = { decks: [YUGI, KAIBA], rules: STANDARD_RULES };
// Main deck sizes the engine never sends: the Extra Rules cards sit in player 0's deck until they remove themselves.
const deckSizes = ({ decks, rules }: Setup): [number, number] => [decks[0].length + rules.cards.length, decks[1].length];

// Identity, profile and Story mode storage, faked in tests.
export type Accounts = {
  verify: (token: string) => Promise<string | null>;
  findProfile: (userId: string) => Promise<Profile | undefined>;
  // Resolves to undefined when the pseudo is already taken.
  createProfile: (userId: string, pseudo: string) => Promise<Profile | undefined>;
  // Ids of the story duels won.
  storyProgress: (userId: string) => Promise<ReadonlySet<string>>;
  // Resolves to the rewards granted, undefined for a duel already won.
  completeStory: (userId: string, duel: StoryDuel) => Promise<Rewards | undefined>;
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
    storyProgress: (userId) => completedDuels(db, userId),
    completeStory: (userId, duel) => completeDuel(db, userId, duel),
  };
}

const PSEUDO = /^[A-Za-z0-9_-]{3,20}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;
// Pause before each answer of the bot, so the human can follow its moves.
const BOT_DELAY = 700;

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
// The pool and the anime cards of the story opponents.
const SERVED: ReadonlySet<number> = new Set([...POOL, ...STORY.anime]);
let cards: [number, Omit<CardInfo, "image">][] | undefined;

// Card data and images for the client (see CardInfo). Images are optional: `pnpm images` downloads them.
function serveHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && req.url === "/api/cards") {
    cards ??= [...SERVED].flatMap((code) => {
      const info = cardInfo(code);
      return info ? [[code, info] as const] : [];
    });
    const body = Object.fromEntries(cards.map(([code, info]) => [code, { ...info, image: existsSync(imageFile(code)) } satisfies CardInfo]));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  const code = Number(IMAGE_URL.exec(req.url ?? "")?.[1]);
  if (req.method === "GET" && SERVED.has(code) && existsSync(imageFile(code))) {
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
    msg.type === "create" ||
    msg.type === "bot" ||
    msg.type === "story" ||
    (msg.type === "story_duel" && typeof msg.duel === "string") ||
    (msg.type === "join" && typeof msg.room === "string") ||
    (msg.type === "respond" && typeof msg.response === "object" && msg.response !== null);
  return valid ? (msg as ClientMessage) : undefined;
}

function ask(room: Room, retry: boolean) {
  const question = room.question;
  if (!question) return;
  const agreed = agreeToRules(question);
  if (agreed) {
    answer(room, question.player as Seat, agreed);
    return;
  }
  const player = room.players[question.player];
  const hidden = hideCards(question, question.player);
  if (player?.bot) play(room, player, hidden, retry);
  else send(player?.socket, { type: "question", question: hidden, retry });
}

// A response the engine refused is replaced by the first valid option, so the bot never blocks the duel.
function play(room: Room, player: Player, question: OcgMessage, retry: boolean) {
  const { bot } = player;
  const asked = room.question;
  if (!bot || !asked) return;
  setTimeout(() => {
    if (room.question !== asked) return;
    try {
      answer(room, asked.player as Seat, retry ? respond(question) : bot.answer(question, player.log));
    } catch (error) {
      fail(room, `bot sans réponse : ${error}`);
    }
  }, bot.delay).unref();
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

function fail(room: Room, error: string) {
  console.error(`[salle ${room.code}] ${error}`);
  room.players.forEach((player) => send(player.socket, { type: "duel_error", error: "le moteur a rencontré une erreur, salle fermée" }));
  endDuel(room);
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
      fail(room, `erreur moteur : ${error}`);
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
    const won = events[win];
    if (won?.type === OcgMessageType.WIN) room.onWin?.(won.player);
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
  const { decks, rules } = room.setup ?? ONLINE;
  room.duel = await openDuel(seed, decks, (text) => console.error(`[salle ${room.code}] ${text}`), undefined, rules);
  advance(room);
}

function newCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// The bot takes seat 1.
export function startServer(port: number, accounts: Accounts, newSeed = randomSeed, botDelay = BOT_DELAY): WebSocketServer {
  const rooms = new Map<string, Room>();
  const http = createServer(serveHttp);
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);

  function sit(room: Room, id: string, socket: WebSocket): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const seat = (known === -1 ? room.players.push({ id, log: [] }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    const setup = room.setup ?? ONLINE;
    send(socket, { type: "joined", room: room.code, seat, lp: setup.rules.lp, decks: deckSizes(setup), log: player.log });
    if (room.question?.player === seat) ask(room, false);
    if (known === -1 && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function addBot(room: Room) {
    const setup = room.setup ?? ONLINE;
    room.players.push({ id: "bot", log: [], bot: new Bot(1, setup.rules.lp, deckSizes(setup), botDelay) });
    start(room, newSeed()).catch((error: unknown) => console.error(error));
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
      user = { id, pseudo: (await accounts.findProfile(id))?.pseudo };
      send(socket, { type: "profile", pseudo: user.pseudo ?? null });
      return undefined;
    }

    async function choosePseudo(player: { id: string; pseudo?: string }, pseudo: string): Promise<string | undefined> {
      if (player.pseudo) return "pseudo déjà choisi";
      if (!PSEUDO.test(pseudo)) return "pseudo invalide : 3 à 20 caractères, lettres sans accent, chiffres, _ ou -";
      const profile = await accounts.createProfile(player.id, pseudo);
      if (!profile) return "pseudo déjà pris";
      player.pseudo = profile.pseudo;
      send(socket, { type: "profile", pseudo: profile.pseudo });
      return undefined;
    }

    function enter(userId: string, room: Room, bot: boolean): string | undefined {
      rooms.set(room.code, room);
      const index = sit(room, userId, socket);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      if (bot) addBot(room);
      return undefined;
    }

    async function showStory(userId: string): Promise<undefined> {
      send(socket, { type: "story", arcs: storyView(await accounts.storyProgress(userId)) });
      return undefined;
    }

    function recordWin(room: Room, userId: string, duel: StoryDuel) {
      accounts.completeStory(userId, duel).then(
        (rewards) => send(room.players[0]?.socket, { type: "story_won", duel: duel.id, outro: duel.outro, rewards: rewards ?? null }),
        (error: unknown) => {
          console.error(error);
          send(room.players[0]?.socket, { type: "error", error: "victoire non enregistrée, rejouez le duel plus tard" });
        },
      );
    }

    // The player keeps seat 0 against the bot; only their win counts.
    async function playStory(userId: string, id: string): Promise<string | undefined> {
      const duel = STORY_DUELS.get(id);
      if (!duel) return "duel d'histoire inconnu";
      if (!isUnlocked(duel, await accounts.storyProgress(userId))) return "duel verrouillé : gagnez d'abord les duels précédents";
      const room: Room = { code: newCode(rooms), players: [], setup: { decks: [YUGI, storyDeck(duel)], rules: storyRules(duel) } };
      room.onWin = (winner) => {
        if (winner === 0) recordWin(room, userId, duel);
      };
      return enter(userId, room, true);
    }

    // Returns an error for the sender, if any.
    function handle(msg: ClientMessage): string | undefined | Promise<string | undefined> {
      if (msg.type === "auth") return identify(msg.token);
      if (!user) return "non authentifié";
      if (msg.type === "pseudo") return choosePseudo(user, msg.pseudo);
      if (!user.pseudo) return "pseudo à choisir d'abord";
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (msg.type === "story") return showStory(user.id);
      if (seat) return "déjà dans une salle";
      if (msg.type === "story_duel") return playStory(user.id, msg.duel);
      const room = msg.type === "join" ? rooms.get(msg.room.toUpperCase()) : { code: newCode(rooms), players: [] };
      if (!room) return "salle introuvable";
      return enter(user.id, room, msg.type === "bot");
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
