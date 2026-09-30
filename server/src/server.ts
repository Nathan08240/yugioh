import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";
import { announceCard } from "./announce.ts";
import { verifySession } from "./auth.ts";
import { boosterState, BOOSTERS, creditBoosters, openBooster, WIN_BOOSTER_REWARD } from "./boosters.ts";
import { Bot } from "./bot.ts";
import { clientCard, RULE_CARDS } from "./cards.ts";
import { dbDeckStore, deckReply, isDeckMessage, poolCard, validDeckMessage, type DeckMessage, type DeckStore } from "./collection.ts";
import { activeDeck, createProfile, findProfile, openDb, type ActiveDeck, type Db, type Profile } from "./db.ts";
import { EXTRA_MAX, isFusion, MAIN_MAX, MAIN_MIN } from "./deckcheck.ts";
import { KAIBA } from "./decks.ts";
import { agreeToRules, fieldStats, openDuel, STANDARD_RULES, type Rules, type Seed } from "./duel.ts";
import { isAllowed, POOL, SETS, type Printing } from "./pool.ts";
import type { CardInfo, ClientMessage, DuelEvent, Rewards, Seat, ServerMessage } from "./protocol.ts";
import { respond } from "./respond.ts";
import { serveClient } from "./site.ts";
import { chooseStarter, starterCards, type Starter } from "./starter.ts";
import { completeDuel, completedDuels, isUnlocked, STORY, STORY_DUELS, storyDeck, storyExtra, storyRules, storyView, type StoryDuel } from "./story.ts";
import { systemStrings } from "./strings.ts";
import { hideCards, visibleTo } from "./visibility.ts";

type Question = Extract<OcgMessage, { player: number }>;
// `stats`: the last stats event sent, as JSON.
// `gone`: the player lost their connection during an online duel and loses it at `at` unless they come back.
type Player = { id: string; name?: string; socket?: WebSocket; log: DuelEvent[]; deck: readonly number[]; extra?: readonly number[]; bot?: Bot; stats?: string; gone?: { at: number; timer: NodeJS.Timeout } };
// Time `left` to the asked seat of an online duel, counting down from `since` while `timer` runs (paused while they are disconnected).
type Clock = { seat: Seat; left: number; since: number; timer?: NodeJS.Timeout };
export type Room = {
  code: string;
  players: Player[];
  // STANDARD_RULES when absent.
  rules?: Rules;
  duel?: Awaited<ReturnType<typeof openDuel>>;
  question?: Question;
  decision?: Clock;
  timer?: NodeJS.Timeout;
  // Rewards of the room: a booster for an online duel, the story progression against the bot.
  onWin?: (winner: number) => void;
};

const rulesOf = (room: Room) => room.rules ?? STANDARD_RULES;
// Main deck sizes the engine never sends: the Extra Rules cards sit in player 0's deck until they remove themselves.
const deckSizes = (room: Room): [number, number] => [
  (room.players[0]?.deck.length ?? 0) + rulesOf(room).cards.length,
  room.players[1]?.deck.length ?? 0,
];
const extraSizes = (room: Room): [number, number] => [room.players[0]?.extra?.length ?? 0, room.players[1]?.extra?.length ?? 0];

// Identity, profile, deck, booster and Story mode storage, faked in tests.
export type Accounts = DeckStore & {
  verify: (token: string) => Promise<string | null>;
  findProfile: (userId: string) => Promise<Profile | undefined>;
  // Resolves to undefined when the pseudo is already taken.
  createProfile: (userId: string, pseudo: string) => Promise<Profile | undefined>;
  activeDeck: (userId: string) => Promise<ActiveDeck | undefined>;
  // Resolves to false when the player already has an active deck.
  chooseStarter: (userId: string, starter: Starter) => Promise<boolean>;
  boosterState: (userId: string) => Promise<{ nextFreeAt: string; pending: number }>;
  // Rejects with a clear message: no right to open, or an unknown set.
  openBooster: (userId: string, setCode: string) => Promise<Printing[]>;
  creditBoosters: (userId: string, count: number) => Promise<void>;
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
    activeDeck: (userId) => activeDeck(db, userId),
    chooseStarter: (userId, starter) => chooseStarter(db, userId, starter),
    boosterState: (userId) => boosterState(db, userId),
    openBooster: (userId, setCode) => openBooster(db, userId, setCode),
    creditBoosters: (userId, count) => creditBoosters(db, userId, count),
    storyProgress: (userId) => completedDuels(db, userId),
    completeStory: (userId, duel) => completeDuel(db, userId, duel),
    ...dbDeckStore(db),
  };
}

const PSEUDO = /^[A-Za-z0-9_-]{3,20}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;
// Pause before each answer of the bot, so the human can follow its moves.
const BOT_DELAY = 700;
// In an online duel between two players: time to answer a question of the engine, and to come back after a lost connection.
export const DECISION_TIME = 2 * 60_000;
export const RECONNECT_TIME = 2 * 60_000;
// WIN reasons of the ends decided by the server, as EDOPro numbers them.
const SURRENDER = 0;
const TIME_LIMIT = 3;
const CONNECTION_LOST = 4;

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

const artFile = (code: number) => join(import.meta.dirname, "..", "vendor", "art", `${code}.jpg`);
const ART_URL = /^\/api\/art\/(\d{1,10})\.jpg$/;
// The pool, the anime cards of the story opponents and the rule cards.
const SERVED: ReadonlySet<number> = new Set([...POOL, ...STORY.anime, ...RULE_CARDS.keys()]);
let cards: [number, Omit<CardInfo, "image">][] | undefined;

// Card data, system strings and artworks for the client (see CardInfo). Artworks are optional: `pnpm images` downloads them.
function serveHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && req.url === "/api/cards") {
    cards ??= [...SERVED].flatMap((code) => {
      const info = clientCard(code);
      return info ? [[code, info] as const] : [];
    });
    const body = Object.fromEntries(cards.map(([code, info]) => [code, { ...info, image: existsSync(artFile(code)) } satisfies CardInfo]));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  if (req.method === "GET" && req.url === "/api/strings") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Object.fromEntries(systemStrings())));
    return;
  }
  if (req.method === "GET" && req.url === "/api/starters") {
    const body = { yugi: starterCards("yugi"), kaiba: starterCards("kaiba") };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  if (req.method === "GET" && req.url === "/api/boosters") {
    const body = [...BOOSTERS.values()].map(({ code, name, date }) => ({ code, name, date }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  if (req.method === "GET" && req.url === "/api/sets") {
    // Boosters then starter decks, each passcode once per set (an Ultimate Rare variant repeats it).
    const body = SETS.map(({ code, name, date, cards }) => ({ code, name, date, cards: [...new Set(cards.map((card) => card.code))] }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  const code = Number(ART_URL.exec(req.url ?? "")?.[1]);
  if (req.method === "GET" && SERVED.has(code) && existsSync(artFile(code))) {
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=86400" });
    createReadStream(artFile(code)).pipe(res);
    return;
  }
  if (serveClient(req, res)) return;
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
    msg.type === "bot" ||
    msg.type === "story" ||
    (msg.type === "story_duel" && typeof msg.duel === "string") ||
    (msg.type === "join" && typeof msg.room === "string") ||
    (msg.type === "respond" && typeof msg.response === "object" && msg.response !== null) ||
    msg.type === "surrender" ||
    msg.type === "booster_state" ||
    (msg.type === "open_booster" && typeof msg.set === "string") ||
    validDeckMessage(msg);
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
      answer(room, asked.player as Seat, retry ? respond(question, announceCard) : bot.answer(question, player.log));
    } catch (error) {
      fail(room, `bot sans réponse : ${error}`);
    }
  }, bot.delay).unref();
}

// The messages each player may see, followed by the monster stats as the engine left them.
function broadcast(room: Room, duel: NonNullable<Room["duel"]>, messages: OcgMessage[]) {
  room.players.forEach((player, seat) => {
    const visible: DuelEvent[] = messages.flatMap((msg) => visibleTo(msg, seat) ?? []);
    const stats = fieldStats(duel, seat);
    const key = JSON.stringify(stats);
    if (visible.length === 0 && key === player.stats) return;
    player.stats = key;
    visible.push(stats);
    player.log.push(...visible);
    send(player.socket, { type: "messages", messages: visible });
  });
}

function endDuel(room: Room) {
  room.duel?.lib.destroyDuel(room.duel.handle);
  room.duel = undefined;
  room.question = undefined;
  clearTimeout(room.decision?.timer);
  room.decision = undefined;
  for (const player of room.players) {
    clearTimeout(player.gone?.timer);
    player.gone = undefined;
  }
}

// Ends the duel like a WIN of the engine, for a reason the engine never sees. Only the first end of a duel counts.
function finish(room: Room, winner: Seat, reason: number) {
  if (!room.duel) return;
  broadcast(room, room.duel, [{ type: OcgMessageType.WIN, player: winner, reason }]);
  room.onWin?.(winner);
  endDuel(room);
}

function surrender(room: Room, seat: Seat): string | undefined {
  if (!room.duel) return "aucun duel en cours";
  finish(room, (1 - seat) as Seat, SURRENDER);
  return undefined;
}

const online = (room: Room) => room.players.length === 2 && !room.players.some((player) => player.bot);
const sendAll = (room: Room, data: ServerMessage) => room.players.forEach((player) => send(player.socket, data));

// Starts or resumes the clock of the asked seat, while they are connected.
function runClock(room: Room) {
  const clock = room.decision;
  if (!clock || clock.timer || !room.players[clock.seat]?.socket) return;
  clock.since = Date.now();
  clock.timer = setTimeout(() => finish(room, (1 - clock.seat) as Seat, TIME_LIMIT), clock.left).unref();
  sendAll(room, { type: "timer", kind: "answer", seat: clock.seat, ms: clock.left });
}

function pauseClock(room: Room) {
  const clock = room.decision;
  if (!clock?.timer) return;
  clearTimeout(clock.timer);
  clock.timer = undefined;
  clock.left -= Date.now() - clock.since;
  sendAll(room, { type: "timer", kind: "answer", seat: clock.seat, ms: null });
}

// A player of an online duel lost their connection: their clock stops, the other wins if they do not come back in time.
function away(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (!room.duel || !online(room) || !player || player.gone) return;
  if (room.decision?.seat === seat) pauseClock(room);
  player.gone = { at: Date.now() + RECONNECT_TIME, timer: setTimeout(() => finish(room, (1 - seat) as Seat, CONNECTION_LOST), RECONNECT_TIME).unref() };
  sendAll(room, { type: "timer", kind: "reconnect", seat, ms: RECONNECT_TIME });
}

// The player is back: their clock resumes, and they get the clocks still running.
function back(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (player?.gone) {
    clearTimeout(player.gone.timer);
    player.gone = undefined;
    sendAll(room, { type: "timer", kind: "reconnect", seat, ms: null });
  }
  const clock = room.decision;
  if (clock?.timer) send(player?.socket, { type: "timer", kind: "answer", seat: clock.seat, ms: clock.left - (Date.now() - clock.since) });
  else runClock(room);
  room.players.forEach((other, index) => {
    if (other.gone) send(player?.socket, { type: "timer", kind: "reconnect", seat: index as Seat, ms: other.gone.at - Date.now() });
  });
}

function fail(room: Room, error: string) {
  console.error(`[salle ${room.code}] ${error}`);
  room.players.forEach((player) => send(player.socket, { type: "duel_error", error: "le moteur a rencontré une erreur, salle fermée" }));
  endDuel(room);
}

// Credits the winner of an online duel between two players with a booster; a duel against the bot earns nothing.
export function creditWinner(room: Room, seat: Seat, accounts: Pick<Accounts, "creditBoosters">) {
  const winnerId = room.players[seat]?.id;
  if (winnerId && !room.players.some((player) => player.bot)) {
    accounts.creditBoosters(winnerId, WIN_BOOSTER_REWARD).catch((error: unknown) => console.error(error));
  }
}

function sendJoined(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (!player) return;
  send(player.socket, { type: "joined", room: room.code, seat, lp: rulesOf(room).lp, decks: deckSizes(room), extras: extraSizes(room), opponent: room.players[1 - seat]?.name, log: player.log });
}

// Runs the engine until it asks a question or the duel ends. A crash inside the engine closes only this room.
export function advance(room: Room) {
  if (!room.duel) return;
  const duel = room.duel;
  const { lib, handle } = duel;
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
    broadcast(room, duel, win === -1 ? events : events.slice(0, win + 1));
    const won = events[win];
    if (won?.type === OcgMessageType.WIN) room.onWin?.(won.player);
    if (win !== -1 || status === OcgProcessResult.END) {
      endDuel(room);
      return;
    }
    const last = messages.at(-1);
    if (status === OcgProcessResult.WAITING && last && "player" in last) {
      clearTimeout(room.decision?.timer);
      room.decision = online(room) ? { seat: last.player as Seat, left: DECISION_TIME, since: 0 } : undefined;
      runClock(room);
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
  const extras = room.players.map((player) => player.extra ?? []);
  room.duel = await openDuel(seed, decks, (text) => console.error(`[salle ${room.code}] ${text}`), undefined, rulesOf(room), extras);
  advance(room);
}

function newCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const isPoolFusion = (code: number) => {
  const card = poolCard(code);
  return card !== undefined && isFusion(card);
};

// A deck as validated for a duel: 40 to 60 cards from the allowed pool, and at most 15 Fusion monsters in the extra deck.
const validDeck = ({ main, extra }: ActiveDeck) =>
  main.length >= MAIN_MIN && main.length <= MAIN_MAX && main.every(isAllowed) && extra.length <= EXTRA_MAX && extra.every(isPoolFusion);

// The bot takes seat 1.
export function startServer(port: number, accounts: Accounts, newSeed = randomSeed, botDelay = BOT_DELAY): WebSocketServer {
  const rooms = new Map<string, Room>();
  const http = createServer(serveHttp);
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);

  function sit(room: Room, id: string, socket: WebSocket, deck: ActiveDeck, name?: string): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const isNew = known === -1;
    const seat = (isNew ? room.players.push({ id, name, log: [], deck: deck.main, extra: deck.extra }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    sendJoined(room, seat);
    back(room, seat);
    // The host's first `joined` guessed the guest's deck size as 0: correct it once they arrive.
    if (isNew && seat === 1) sendJoined(room, 0);
    if (room.question?.player === seat) ask(room, false);
    if (isNew && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function addBot(room: Room, deck: ActiveDeck, name: string) {
    const player: Player = { id: "bot", name, log: [], deck: deck.main, extra: deck.extra };
    room.players.push(player);
    player.bot = new Bot(1, rulesOf(room).lp, deckSizes(room), botDelay, extraSizes(room));
    sendJoined(room, 0);
    start(room, newSeed()).catch((error: unknown) => console.error(error));
  }

  function leave(room: Room, socket: WebSocket) {
    const seat = room.players.findIndex((seated) => seated.socket === socket);
    if (seat !== -1) {
      room.players[seat].socket = undefined;
      away(room, seat as Seat);
    }
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

    async function manageDecks(player: { id: string }, msg: DeckMessage): Promise<string | undefined> {
      const reply = await deckReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function sendBoosterState(player: { id: string }): Promise<string | undefined> {
      send(socket, { type: "booster_state", ...(await accounts.boosterState(player.id)) });
      return undefined;
    }

    async function openBoosterFor(player: { id: string }, set: string): Promise<string | undefined> {
      try {
        send(socket, { type: "booster_opened", set, cards: await accounts.openBooster(player.id, set) });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "erreur inattendue";
      }
    }

    // The active deck of the player, or the error that keeps them out of a duel.
    async function duelDeck(userId: string): Promise<ActiveDeck | string> {
      const deck = await accounts.activeDeck(userId);
      if (!deck) return "deck actif requis";
      return validDeck(deck) ? deck : "deck actif invalide";
    }

    function enter(userId: string, room: Room, deck: ActiveDeck, bot?: { deck: ActiveDeck; name: string }): string | undefined {
      rooms.set(room.code, room);
      const index = sit(room, userId, socket, deck, user?.pseudo);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      if (bot) addBot(room, bot.deck, bot.name);
      return undefined;
    }

    // An online room rewards its winner with a booster, a quick duel against the bot rewards nothing.
    async function enterRoom(userId: string, msg: Extract<ClientMessage, { type: "create" | "join" | "bot" }>): Promise<string | undefined> {
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      if (msg.type === "join") {
        const joined = rooms.get(msg.room.toUpperCase());
        return joined ? enter(userId, joined, deck) : "salle introuvable";
      }
      const room: Room = { code: newCode(rooms), players: [] };
      if (msg.type === "bot") return enter(userId, room, deck, { deck: { main: KAIBA, extra: [] }, name: "Bot" });
      room.onWin = (winner) => creditWinner(room, winner as Seat, accounts);
      return enter(userId, room, deck);
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
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      const room: Room = { code: newCode(rooms), players: [], rules: storyRules(duel) };
      room.onWin = (winner) => {
        if (winner === 0) recordWin(room, userId, duel);
      };
      return enter(userId, room, deck, { deck: { main: storyDeck(duel), extra: storyExtra(duel) }, name: duel.opponent });
    }

    // Returns an error for the sender, if any.
    function handle(msg: ClientMessage): string | undefined | Promise<string | undefined> {
      if (msg.type === "auth") return identify(msg.token);
      if (!user) return "non authentifié";
      if (msg.type === "pseudo") return choosePseudo(user, msg.pseudo);
      if (!user.pseudo) return "pseudo à choisir d'abord";
      if (msg.type === "starter") return pickStarter(user, msg.starter);
      if (isDeckMessage(msg)) return manageDecks(user, msg);
      if (msg.type === "booster_state") return sendBoosterState(user);
      if (msg.type === "open_booster") return openBoosterFor(user, msg.set);
      if (msg.type === "story") return showStory(user.id);
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (msg.type === "surrender") return seat ? surrender(seat.room, seat.index) : "pas dans une salle";
      if (seat) return "déjà dans une salle";
      if (msg.type === "story_duel") return playStory(user.id, msg.duel);
      return enterRoom(user.id, msg);
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
  // Missing artworks download in the background: the server answers without them meanwhile.
  if ([...SERVED].some((code) => !existsSync(artFile(code)))) {
    spawn(process.execPath, [join(import.meta.dirname, "..", "scripts", "images.ts")], { stdio: "inherit" }).on("error", console.error);
  }
  // As PID 1 in a container, Node ignores SIGTERM without a handler.
  process.on("SIGTERM", () => process.exit());
}
