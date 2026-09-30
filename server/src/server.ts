import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";
import { announceCard, declarable } from "./announce.ts";
import { verifySession } from "./auth.ts";
import { boosterState, BOOSTERS, creditBoosters, openBooster, WIN_BOOSTER_REWARD } from "./boosters.ts";
import { Bot } from "./bot.ts";
import { clientCard, RULE_CARDS } from "./cards.ts";
import { dbDeckStore, deckReply, isDeckMessage, poolCard, validDeckMessage, type DeckMessage, type DeckStore } from "./collection.ts";
import { activeDeck, createProfile, findProfile, openDb, type ActiveDeck, type Db, type Profile } from "./db.ts";
import { EXTRA_MAX, isFusion, MAIN_MAX, MAIN_MIN } from "./deckcheck.ts";
import { KAIBA } from "./decks.ts";
import { agreeToRules, fieldMoves, fieldStats, lpLeft, lpOf, openDuel, STANDARD_RULES, type Placed, type Rules, type Seed } from "./duel.ts";
import { CRAFT_COSTS, dbEconomyStore, economyReply, isEconomyMessage, validEconomyMessage, type EconomyMessage, type EconomyStore } from "./economy.ts";
import { EMOTE_DELAY, EMOTE_IDS, type EmoteId } from "./emotes.ts";
import { claimEvent, eventOf, eventRules, eventWon, type WeeklyEvent } from "./event.ts";
import { isAllowed, POOL, SETS, type Printing } from "./pool.ts";
import { dbProfileStore, isProfileMessage, profileReply, validProfileMessage, type ProfileMessage, type ProfileStore } from "./profile.ts";
import { PUZZLE_FAILED, REPORT_MAX, type BotLevel, type CardInfo, type ClientMessage, type DeckResult, type DuelEvent, type Seat, type ServerMessage, type StoryLevel, type StoryResult, type TowerView } from "./protocol.ts";
import { PUZZLE_IDS, PUZZLE_TURNS, puzzleField, puzzleRules, puzzleView, solvedPuzzles, solvePuzzle } from "./puzzles.ts";
import { REPORT_BYTES, RESPONSE_BYTES, saveReport, type Report } from "./report.ts";
import { engineForm, respond } from "./respond.ts";
import { type DuelResult, readResults, recordResult } from "./results.ts";
import { botDeck, dbSealedStore, isSealedMessage, sealedReply, validSealedMessage, type SealedMessage, type SealedStore } from "./sealed.ts";
import { serveClient } from "./site.ts";
import { chooseStarter, starterCards, type Starter } from "./starter.ts";
import { completeDuel, completedDuels, isUnlocked, STORY, STORY_DUELS, storyDeck, storyExtra, storyRules, storyStars, storyView, type StoryDuel } from "./story.ts";
import { systemStrings } from "./strings.ts";
import { startTower, TOWER, towerLevel, towerRules, towerView, winTower, type TowerWin } from "./tower.ts";
import { hideCards, visibleTo } from "./visibility.ts";
import { dbWishStore, isWishMessage, validWishMessage, wishReply, type WishMessage, type WishStore } from "./wishlist.ts";
import { dbWonderStore, isWonderMessage, validWonderMessage, wonderReply, type WonderMessage, type WonderStore } from "./wonder.ts";

type Question = Extract<OcgMessage, { player: number }>;
// `stats`: the last stats event sent, as JSON.
// `gone`: the player lost their connection during an online duel and loses it at `at` unless they come back.
type Player = { id: string; name?: string; avatar?: number; socket?: WebSocket; log: DuelEvent[]; deck: readonly number[]; deckId?: number; extra?: readonly number[]; bot?: Bot; stats?: string; gone?: { at: number; timer: NodeJS.Timeout } };
// Time `left` to the asked seat of an online duel, counting down from `since` while `timer` runs (paused while they are disconnected).
type Clock = { seat: Seat; left: number; since: number; timer?: NodeJS.Timeout };
export type Room = {
  code: string;
  players: Player[];
  // STANDARD_RULES when absent.
  rules?: Rules;
  // The event of the week this room plays under: its `rules` are the event's.
  event?: WeeklyEvent;
  // A puzzle: the cards placed before the start, and the last turn before the duel is lost by seat 0.
  field?: Placed[];
  turnLimit?: number;
  duel?: Awaited<ReturnType<typeof openDuel>>;
  question?: Question;
  decision?: Clock;
  timer?: NodeJS.Timeout;
  // The duel has ended: a rematch may start. `rematch`: the seat that asked for one online, or "declined" for good.
  over?: boolean;
  rematch?: Seat | "declined";
  // Level of the bot of the room, kept for a rematch.
  level?: BotLevel;
  // Rewards of the room: a booster for an online duel, the story progression against the bot.
  onWin?: (winner: number) => void;
  // Mode of the duel, and NEW_TURN messages so far: stored for each human player when the duel ends.
  mode?: Pick<DuelResult, "mode" | "level">;
  turns?: number;
  onEnd?: (winner: Seat, reason: number) => void;
  // A duel still running when the room expires is lost by seat 0 (Sealed mode).
  forfeit?: boolean;
  // What a bug report needs to replay the current (or last) duel: its seed, decks, turn and every response the engine accepted.
  record?: { seed: Seed; decks: Report["decks"]; turn: number; responses: OcgResponse[] };
  // Tower mode: the floor of the duel, and the recording of its win once seat 0 won.
  tower?: { floor: number; saved?: Promise<void> };
};

const rulesOf = (room: Room) => room.rules ?? STANDARD_RULES;
// Main deck sizes the engine never sends: the Extra Rules cards sit in player 0's deck until they remove themselves.
const deckSizes = (room: Room): [number, number] => [
  (room.players[0]?.deck.length ?? 0) + rulesOf(room).cards.length,
  room.players[1]?.deck.length ?? 0,
];
const extraSizes = (room: Room): [number, number] => [room.players[0]?.extra?.length ?? 0, room.players[1]?.extra?.length ?? 0];

// Identity, profile, deck, booster and Story mode storage, faked in tests.
export type Accounts = DeckStore & WishStore & EconomyStore & WonderStore & ProfileStore & SealedStore & {
  verify: (token: string) => Promise<string | null>;
  findProfile: (userId: string) => Promise<Profile | undefined>;
  // Resolves to undefined when the pseudo is already taken.
  createProfile: (userId: string, pseudo: string) => Promise<Profile | undefined>;
  activeDeck: (userId: string) => Promise<ActiveDeck | undefined>;
  // Resolves to false when the player already has an active deck.
  chooseStarter: (userId: string, starter: Starter) => Promise<boolean>;
  boosterState: (userId: string) => Promise<{ nextFreeAt: string; pending: number; ultraIn: number }>;
  // Rejects with a clear message: no right to open, or an unknown set.
  openBooster: (userId: string, setCode: string) => Promise<Printing[]>;
  creditBoosters: (userId: string, count: number) => Promise<void>;
  // Best stars of each story duel won, by id.
  storyProgress: (userId: string) => Promise<ReadonlyMap<string, number>>;
  // Records a win with its stars, resolves to what it earned.
  completeStory: (userId: string, duel: StoryDuel, stars: number) => Promise<StoryResult>;
  // Stores the result of a finished duel for a human player, and reads their wins and losses per deck and mode.
  recordResult: (result: DuelResult) => Promise<void>;
  duelResults: (userId: string) => Promise<DeckResult[]>;
  // Ids of the puzzles solved; recording a solved puzzle resolves to true the first time, which earns a booster.
  solvedPuzzles: (userId: string) => Promise<ReadonlySet<string>>;
  solvePuzzle: (userId: string, id: string) => Promise<boolean>;
  // Resolves to false when the player already sent too many reports this hour.
  saveReport: (userId: string, message: string, report: Report) => Promise<boolean>;
  // Event of the week (event.ts): whether its booster was taken, and taking it (resolves to false when it already was).
  eventWon: (userId: string, eventId: string) => Promise<boolean>;
  claimEvent: (userId: string, eventId: string) => Promise<boolean>;
  // Tower mode (tower.ts): progression, the floor of the next duel, the win of a floor.
  towerView: (userId: string) => Promise<TowerView>;
  startTower: (userId: string) => Promise<number>;
  winTower: (userId: string, floor: number) => Promise<TowerWin>;
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
    completeStory: (userId, duel, stars) => completeDuel(db, userId, duel, stars),
    recordResult: (result) => recordResult(db, result),
    duelResults: (userId) => readResults(db, userId),
    solvedPuzzles: (userId) => solvedPuzzles(db, userId),
    solvePuzzle: (userId, id) => solvePuzzle(db, userId, id),
    saveReport: (userId, message, report) => saveReport(db, userId, message, report),
    eventWon: (userId, eventId) => eventWon(db, userId, eventId),
    claimEvent: (userId, eventId) => claimEvent(db, userId, eventId),
    towerView: (userId) => towerView(db, userId),
    startTower: (userId) => startTower(db, userId),
    winTower: (userId, floor) => winTower(db, userId, floor),
    ...dbDeckStore(db),
    ...dbWishStore(db),
    ...dbEconomyStore(db),
    ...dbWonderStore(db),
    ...dbProfileStore(db),
    ...dbSealedStore(db),
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
// The bot greets this long after the room opens, once the client has the duel on screen.
const BOT_GREETING_DELAY = 1500;
// WIN reasons of the ends decided by the server, as EDOPro numbers them.
const SURRENDER = 0;
const TIME_LIMIT = 3;
const CONNECTION_LOST = 4;

// Response type the engine expects for each of its questions.
export const ANSWERS = new Map<OcgMessageType, OcgResponseType>([
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
  if (req.method === "GET" && req.url === "/api/craft") {
    // Points to obtain each booster card as [passcode, cost].
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([...CRAFT_COSTS]));
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

export const ADMIN_BOOSTERS_MAX = 50;
// Comma-separated Supabase user ids allowed to use the admin commands.
const adminIds = (value = "") => new Set(value.split(",").map((id) => id.trim()).filter(Boolean));
const dailyFlag = (daily: boolean) => (daily ? { daily: true as const } : {});

const BOT_LEVELS = new Set<unknown>(["debutant", "normal", "expert"] satisfies BotLevel[]);
const STORY_LEVELS = new Set<unknown>(["normal", "facile"] satisfies StoryLevel[]);

const isOptionalFlag = (value: unknown) => value === undefined || typeof value === "boolean";

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
    (msg.type === "create" && isOptionalFlag(msg.event)) ||
    (msg.type === "bot" && (msg.level === undefined || BOT_LEVELS.has(msg.level)) && isOptionalFlag(msg.event)) ||
    msg.type === "story" ||
    msg.type === "duel_results" ||
    msg.type === "event" ||
    msg.type === "puzzles" ||
    (msg.type === "puzzle" && typeof msg.id === "string") ||
    msg.type === "tower" ||
    msg.type === "tower_duel" ||
    (msg.type === "story_duel" && typeof msg.duel === "string" && (msg.level === undefined || STORY_LEVELS.has(msg.level))) ||
    (msg.type === "emote" && EMOTE_IDS.has(msg.id)) ||
    (msg.type === "join" && typeof msg.room === "string") ||
    (msg.type === "respond" && typeof msg.response === "object" && msg.response !== null) ||
    msg.type === "surrender" ||
    (msg.type === "report" && (msg.message === undefined || typeof msg.message === "string")) ||
    (msg.type === "rematch" && (msg.accept === undefined || typeof msg.accept === "boolean")) ||
    msg.type === "booster_state" ||
    (msg.type === "open_booster" && typeof msg.set === "string") ||
    (msg.type === "admin_boosters" && typeof msg.count === "number" && Number.isInteger(msg.count) && msg.count >= 1 && msg.count <= ADMIN_BOOSTERS_MAX) ||
    validDeckMessage(msg) ||
    validWonderMessage(msg) ||
    validWishMessage(msg) ||
    validEconomyMessage(msg) ||
    validProfileMessage(msg) ||
    validSealedMessage(msg);
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
  else {
    const announce = question.type === OcgMessageType.ANNOUNCE_CARD ? { announce: declarable(question.opcodes) } : {};
    send(player?.socket, { type: "question", question: hidden, retry, ...announce });
  }
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
  room.over = true;
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
  room.onEnd?.(winner, reason);
  endDuel(room);
}

function surrender(room: Room, seat: Seat): string | undefined {
  if (!room.duel) return "aucun duel en cours";
  finish(room, (1 - seat) as Seat, SURRENDER);
  return undefined;
}

const online = (room: Room) => room.players.length === 2 && !room.players.some((player) => player.bot);
const sendAll = (room: Room, data: ServerMessage) => room.players.forEach((player) => send(player.socket, data));

// The report of the current or last duel of the room, undefined before it started.
function reportOf(room: Room): Report | undefined {
  const { record } = room;
  if (!record) return undefined;
  let mode: Report["mode"] = "bot";
  if (online(room)) mode = "online";
  else if (room.field) mode = "puzzle";
  else if (room.mode?.mode === "story") mode = "histoire";
  return { mode, room: room.code, turn: record.turn, date: new Date().toISOString(), level: room.level, seed: record.seed.map(String), rules: rulesOf(room), decks: record.decks, field: room.field, responses: record.responses };
}

// When each player last sent an emote, in ms since the epoch.
const lastEmote = new WeakMap<Player, number>();

// Relays an emote to both seats; one sent less than EMOTE_DELAY after the previous one is dropped.
function emote(room: Room, seat: Seat, id: EmoteId): string | undefined {
  const player = room.players[seat];
  if (!room.duel) return "aucun duel en cours";
  const now = Date.now();
  if (now - (lastEmote.get(player) ?? -Infinity) < EMOTE_DELAY) return undefined;
  lastEmote.set(player, now);
  sendAll(room, { type: "emote", seat, id });
  return undefined;
}

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

// Tower mode: sets the room up for `floor`, with its opponent once the bot is seated. Only a win of seat 0 is recorded:
// startTower already counted anything else as a loss.
export function towerFloor(room: Room, floor: number, accounts: Pick<Accounts, "winTower">) {
  const level = towerLevel(floor);
  const tower: NonNullable<Room["tower"]> = { floor };
  const opponent = TOWER[floor - 1];
  room.rules = towerRules(floor);
  room.level = level;
  room.mode = { mode: "bot", level };
  room.tower = tower;
  const bot = room.players[1];
  if (bot) {
    bot.name = opponent.name;
    bot.deck = opponent.main;
    bot.extra = opponent.extra;
  }
  room.onWin = (winner) => {
    const player = room.players[0];
    if (winner !== 0 || !player) return;
    tower.saved = accounts.winTower(player.id, floor).then(
      (won) => send(room.players[0]?.socket, { type: "tower_won", ...won }),
      (error: unknown) => {
        console.error(error);
        send(room.players[0]?.socket, { type: "error", error: "victoire non enregistrée, l'étage est à rejouer" });
      },
    );
  };
}

// The online rematch pending, if any, for a seat that comes back.
function rematchMessage(room: Room): ServerMessage | undefined {
  if (room.rematch === undefined) return undefined;
  return room.rematch === "declined" ? { type: "rematch_declined" } : { type: "rematch", from: room.rematch };
}

function declineRematch(room: Room) {
  room.rematch = "declined";
  sendAll(room, { type: "rematch_declined" });
}

function sendJoined(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (!player) return;
  const [lp, opponentLp] = [lpOf(rulesOf(room), seat), lpOf(rulesOf(room), 1 - seat)];
  send(player.socket, { type: "joined", room: room.code, seat, lp, opponentLp: opponentLp === lp ? undefined : opponentLp, decks: deckSizes(room), extras: extraSizes(room), opponent: room.players[1 - seat]?.name, opponentAvatar: room.players[1 - seat]?.avatar, special: room.event && [room.event.rule], log: player.log, floor: room.tower?.floor });
}

// The events up to the start of the turn after room.turnLimit, replaced by a win of seat 1: the puzzle is failed.
function limitTurns(room: Room, events: OcgMessage[]): OcgMessage[] {
  if (room.turnLimit === undefined) return events;
  let turns = room.turns ?? 0;
  for (const [index, msg] of events.entries()) {
    if (msg.type !== OcgMessageType.NEW_TURN) continue;
    turns++;
    if (turns > room.turnLimit) return [...events.slice(0, index), { type: OcgMessageType.WIN, player: 1, reason: PUZZLE_FAILED }];
  }
  return events;
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
      // The engine refused the last response: the replay must not send it.
      room.record?.responses.pop();
      ask(room, true);
      return;
    }
    const events = limitTurns(room, messages.filter((msg) => !ANSWERS.has(msg.type)));
    room.turns = (room.turns ?? 0) + events.filter((msg) => msg.type === OcgMessageType.NEW_TURN).length;
    if (room.record) room.record.turn += events.filter((msg) => msg.type === OcgMessageType.NEW_TURN).length;
    // The engine keeps sending WIN without ever reaching END: the first one closes the duel.
    const win = events.findIndex((msg) => msg.type === OcgMessageType.WIN);
    broadcast(room, duel, win === -1 ? events : events.slice(0, win + 1));
    const won = events[win];
    if (won?.type === OcgMessageType.WIN) {
      room.onWin?.(won.player);
      room.onEnd?.(won.player as Seat, won.reason);
    }
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
  if (JSON.stringify(response).length > RESPONSE_BYTES) return "réponse trop volumineuse";
  try {
    if (response.type !== ANSWERS.get(question.type)) throw new Error("type de réponse inattendu");
    room.duel.lib.duelSetResponse(room.duel.handle, engineForm(response));
  } catch {
    ask(room, true);
    return undefined;
  }
  room.record?.responses.push(response);
  advance(room);
  return undefined;
}

async function start(room: Room, seed: Seed) {
  const decks = room.players.map((player) => player.deck);
  const extras = room.players.map((player) => player.extra ?? []);
  room.turns = 0;
  room.record = { seed, decks: decks.map((main, seat) => ({ main: [...main], extra: [...extras[seat]] })), turn: 0, responses: [] };
  room.duel = await openDuel(seed, decks, (text) => console.error(`[salle ${room.code}] ${text}`), undefined, rulesOf(room), extras, room.field);
  if (room.field) broadcast(room, room.duel, fieldMoves(room.field));
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
  const admins = adminIds(process.env.ADMIN_USER_IDS);
  const adminFlag = (id: string) => (admins.has(id) ? { admin: true as const } : {});
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);

  function sit(room: Room, id: string, socket: WebSocket, deck: ActiveDeck, name?: string, avatar?: number): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const isNew = known === -1;
    const seat = (isNew ? room.players.push({ id, name, avatar, log: [], deck: deck.main, deckId: deck.id, extra: deck.extra }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    sendJoined(room, seat);
    back(room, seat);
    // The host's first `joined` guessed the guest's deck size as 0: correct it once they arrive.
    if (isNew && seat === 1) sendJoined(room, 0);
    if (room.question?.player === seat) ask(room, false);
    const pending = rematchMessage(room);
    if (pending) send(player.socket, pending);
    if (isNew && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function addBot(room: Room, deck: ActiveDeck, name: string, level?: BotLevel) {
    const player: Player = { id: "bot", name, log: [], deck: deck.main, extra: deck.extra };
    room.players.push(player);
    room.level = level;
    player.bot = newBot(room);
    sendJoined(room, 0);
    start(room, newSeed()).catch((error: unknown) => console.error(error));
  }

  const newBot = (room: Room) => new Bot(1, lpOf(rulesOf(room), 1), deckSizes(room), botDelay, extraSizes(room), room.level);

  // A new duel in the same room, from empty logs. The caller has checked `room.over`.
  function restart(room: Room) {
    room.over = false;
    room.rematch = undefined;
    for (const player of room.players) {
      player.log = [];
      player.stats = undefined;
      if (player.bot) player.bot = newBot(room);
    }
    room.players.forEach((_player, index) => sendJoined(room, index as Seat));
    start(room, newSeed()).catch((error: unknown) => console.error(error));
  }

  // After a tower duel: the next floor once its win is recorded, floor 1 after a loss.
  async function climb(room: Room, tower: NonNullable<Room["tower"]>) {
    await tower.saved;
    towerFloor(room, await accounts.startTower(room.players[0].id), accounts);
  }

  function leave(room: Room, socket: WebSocket) {
    const seat = room.players.findIndex((seated) => seated.socket === socket);
    if (seat !== -1) {
      room.players[seat].socket = undefined;
      away(room, seat as Seat);
      if (room.over && online(room) && room.rematch !== "declined") declineRematch(room);
    }
    if (room.players.some((player) => player.socket)) return;
    room.timer = setTimeout(() => {
      if (room.forfeit) finish(room, 1, CONNECTION_LOST);
      endDuel(room);
      rooms.delete(room.code);
    }, ROOM_TTL).unref();
  }

  wss.on("connection", (socket) => {
    let user: { id: string; pseudo?: string; avatar?: number } | undefined;
    let seat: { room: Room; index: Seat } | undefined;
    // Messages are handled one at a time, so an action sent right after `auth` waits for its verification.
    let queue = Promise.resolve();

    async function identify(token: string): Promise<string | undefined> {
      if (user) return "déjà authentifié";
      const id = await accounts.verify(token);
      if (!id) return "jeton invalide";
      const profile = await accounts.findProfile(id);
      user = { id, pseudo: profile?.pseudo, avatar: profile && ((await accounts.profileCards(id)).avatar ?? undefined) };
      const daily = profile !== undefined && (await accounts.claimDaily(id));
      send(socket, { type: "profile", pseudo: user.pseudo ?? null, needsStarter: profile !== undefined && profile.activeDeckId === null, ...adminFlag(id), ...dailyFlag(daily) });
      return undefined;
    }

    async function choosePseudo(player: { id: string; pseudo?: string }, pseudo: string): Promise<string | undefined> {
      if (player.pseudo) return "pseudo déjà choisi";
      if (!PSEUDO.test(pseudo)) return "pseudo invalide : 3 à 20 caractères, lettres sans accent, chiffres, _ ou -";
      const profile = await accounts.createProfile(player.id, pseudo);
      if (!profile) return "pseudo déjà pris";
      player.pseudo = profile.pseudo;
      const daily = await accounts.claimDaily(player.id);
      send(socket, { type: "profile", pseudo: profile.pseudo, needsStarter: profile.activeDeckId === null, ...adminFlag(player.id), ...dailyFlag(daily) });
      return undefined;
    }

    async function pickStarter(player: { id: string; pseudo?: string }, starter: Starter): Promise<string | undefined> {
      const chosen = await accounts.chooseStarter(player.id, starter);
      if (!chosen) return "starter déjà choisi";
      send(socket, { type: "profile", pseudo: player.pseudo ?? null, needsStarter: false, ...adminFlag(player.id) });
      return undefined;
    }

    async function manageDecks(player: { id: string }, msg: DeckMessage): Promise<string | undefined> {
      const reply = await deckReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageWishes(player: { id: string }, msg: WishMessage): Promise<string | undefined> {
      const reply = await wishReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageEconomy(player: { id: string }, msg: EconomyMessage): Promise<string | undefined> {
      const reply = await economyReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageWonder(player: { id: string }, msg: WonderMessage): Promise<string | undefined> {
      const reply = await wonderReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageProfile(player: { id: string; avatar?: number }, msg: ProfileMessage): Promise<string | undefined> {
      const reply = await profileReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      if (reply.type === "player_profile") player.avatar = reply.avatar ?? undefined;
      send(socket, reply);
      return undefined;
    }

    async function grantBoosters(player: { id: string }, count: number): Promise<string | undefined> {
      if (!admins.has(player.id)) return "commande réservée";
      await accounts.creditBoosters(player.id, count);
      return sendBoosterState(player);
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

    // Stores the result of the duel for each human player. A failure is logged, the duel is over anyway.
    function recordResults(room: Room, winner: Seat, reason: number) {
      const { mode } = room;
      if (!mode) return;
      room.players.forEach((player, index) => {
        if (player.bot) return;
        const result = { userId: player.id, deckId: player.deckId, ...mode, won: index === winner, reason, turns: room.turns ?? 0 };
        accounts.recordResult(result).catch((error: unknown) => console.error(error));
      });
    }

    function enter(userId: string, room: Room, deck: ActiveDeck, bot?: { deck: ActiveDeck; name: string; level?: BotLevel }): string | undefined {
      room.onEnd = (winner, reason) => recordResults(room, winner, reason);
      rooms.set(room.code, room);
      const index = sit(room, userId, socket, deck, user?.pseudo, user?.avatar);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      if (bot) addBot(room, bot.deck, bot.name, bot.level);
      return undefined;
    }

    // The first win of the week in an event room earns a booster, for a human seat only.
    function rewardEvent(room: Room, seat: number) {
      const player = room.players[seat];
      if (!room.event || !player || player.bot) return;
      accounts.claimEvent(player.id, room.event.id).then(
        (earned) => {
          if (earned) send(player.socket, { type: "event_won" });
        },
        (error: unknown) => console.error(error),
      );
    }

    // The bot of a quick duel sometimes greets and compliments its winner, as a player would.
    function enterBotRoom(userId: string, room: Room, deck: ActiveDeck, level?: BotLevel): string | undefined {
      const botSays = (id: EmoteId) => sendAll(room, { type: "emote", seat: 1, id });
      room.onWin = (winner) => {
        if (winner === 0) botSays("bienjoue");
        rewardEvent(room, winner);
      };
      const error = enter(userId, room, deck, { deck: { main: KAIBA, extra: [] }, name: "Bot", level });
      if (!error && randomInt(2) === 0) setTimeout(() => botSays("bonduel"), BOT_GREETING_DELAY).unref();
      return error;
    }

    // An online room rewards its winner with a booster, a quick duel against the bot rewards nothing.
    async function enterRoom(userId: string, msg: Extract<ClientMessage, { type: "create" | "join" | "bot" }>): Promise<string | undefined> {
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      if (msg.type === "join") {
        const joined = rooms.get(msg.room.toUpperCase());
        return joined ? enter(userId, joined, deck) : "salle introuvable";
      }
      const room: Room = { code: newCode(rooms), players: [], mode: { mode: "online" } };
      if (msg.event) {
        room.event = eventOf();
        room.rules = eventRules(room.event);
      }
      if (msg.type === "bot") {
        room.mode = { mode: "bot", level: msg.level ?? "normal" };
        return enterBotRoom(userId, room, deck, msg.level);
      }
      room.onWin = (winner) => {
        creditWinner(room, winner as Seat, accounts);
        rewardEvent(room, winner);
      };
      return enter(userId, room, deck);
    }

    async function manageSealed(player: { id: string }, msg: SealedMessage): Promise<string | undefined> {
      const reply = await sealedReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    // The next duel of the Sealed session, against the bot at "normal" with a deck from its own boosters of the same set.
    // A duel left unfinished resumes; left until its room expires, it is lost. A draw does not count.
    async function playSealed(userId: string): Promise<string | undefined> {
      const running = [...rooms.values()].find((room) => room.forfeit && room.duel && room.players[0]?.id === userId);
      if (running) return enter(userId, running, { main: [], extra: [] });
      const run = await accounts.sealedRun(userId);
      if (run?.status !== "playing" || !run.main) return "aucun duel Scellé à jouer";
      const room: Room = { code: newCode(rooms), players: [], mode: { mode: "bot", level: "normal" }, forfeit: true };
      room.onWin = (winner) => {
        if (winner > 1) return;
        accounts.sealedResult(userId, run.id, winner === 0).then(
          (updated) => {
            if (updated) send(room.players[0]?.socket, { type: "sealed", run: updated });
          },
          (error: unknown) => console.error(error),
        );
      };
      return enter(userId, room, { main: run.main, extra: run.extra ?? [] }, { deck: botDeck(run.set), name: "Bot", level: "normal" });
    }

    async function reportBug(room: Room, userId: string, text = ""): Promise<string | undefined> {
      const message = text.trim();
      if (message.length > REPORT_MAX) return `texte trop long : ${REPORT_MAX} caractères au maximum`;
      const report = reportOf(room);
      if (!report) return "aucun duel à signaler";
      if (JSON.stringify(report).length > REPORT_BYTES) return "duel trop long pour être signalé";
      if (!(await accounts.saveReport(userId, message, report))) return "trop de signalements, réessayez dans une heure";
      send(socket, { type: "report_sent" });
      return undefined;
    }

    async function showStory(userId: string): Promise<undefined> {
      send(socket, { type: "story", arcs: storyView(await accounts.storyProgress(userId)) });
      return undefined;
    }

    function recordWin(room: Room, userId: string, duel: StoryDuel, stars: number) {
      accounts.completeStory(userId, duel, stars).then(
        (result) => send(room.players[0]?.socket, { type: "story_won", duel: duel.id, outro: duel.outro, ...result }),
        (error: unknown) => {
          console.error(error);
          send(room.players[0]?.socket, { type: "error", error: "victoire non enregistrée, rejouez le duel plus tard" });
        },
      );
    }

    // The player keeps seat 0 against the bot; only their win counts.
    async function playStory(userId: string, id: string, level?: StoryLevel): Promise<string | undefined> {
      const duel = STORY_DUELS.get(id);
      if (!duel) return "duel d'histoire inconnu";
      if (!isUnlocked(duel, await accounts.storyProgress(userId))) return "duel verrouillé : gagnez d'abord les duels précédents";
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      const rules = storyRules(duel, level);
      const room: Room = { code: newCode(rooms), players: [], rules, mode: { mode: "story", level: level ?? "normal" } };
      // The duel is still open when its winner is known: its LP give the stars.
      room.onWin = (winner) => {
        if (winner === 0 && room.duel) recordWin(room, userId, duel, storyStars(level === "facile", lpLeft(room.duel, 0), lpOf(rules, 0)));
      };
      return enter(userId, room, deck, { deck: { main: storyDeck(duel), extra: storyExtra(duel) }, name: duel.opponent });
    }

    async function showEvent(userId: string): Promise<undefined> {
      const { id, rule, lp, hand } = eventOf();
      send(socket, { type: "event", rule, lp, hand, won: await accounts.eventWon(userId, id) });
      return undefined;
    }

    // Against the bot, a rematch starts at once (the next floor of the tower). Online, it starts once both seats asked, with their active decks of the moment.
    async function rematch(room: Room, index: Seat, accept: boolean): Promise<string | undefined> {
      if (!room.over) return "aucun duel terminé";
      if (room.forfeit) return "le duel suivant se lance depuis l'écran Scellé";
      const bot = room.players.some((player) => player.bot);
      if (room.rematch === "declined") return "revanche refusée";
      if (!accept) {
        if (!bot) declineRematch(room);
        return undefined;
      }
      if (bot) {
        // Set first: a second rematch cannot climb twice.
        room.over = false;
        if (room.tower) await climb(room, room.tower);
        restart(room);
        return undefined;
      }
      if (!room.players[1 - index]?.socket) {
        declineRematch(room);
        return undefined;
      }
      if (room.rematch === undefined) {
        room.rematch = index;
        sendAll(room, { type: "rematch", from: index });
        return undefined;
      }
      if (room.rematch === index) return undefined;
      room.over = false;
      const decks = await Promise.all(room.players.map((player) => duelDeck(player.id)));
      const invalid = decks.find((deck): deck is string => typeof deck === "string");
      if (invalid !== undefined) {
        room.over = true;
        declineRematch(room);
        return invalid;
      }
      room.players.forEach((player, seatIndex) => {
        const deck = decks[seatIndex] as ActiveDeck;
        player.deck = deck.main;
        player.deckId = deck.id;
        player.extra = deck.extra;
      });
      restart(room);
      return undefined;
    }

    async function showPuzzles(userId: string): Promise<undefined> {
      send(socket, { type: "puzzles", puzzles: puzzleView(await accounts.solvedPuzzles(userId)) });
      return undefined;
    }

    // The player keeps seat 0 against the Normal bot, from the state of the puzzle, without their deck; only their win counts.
    function playPuzzle(userId: string, id: string): string | undefined {
      const puzzle = PUZZLE_IDS.get(id);
      if (!puzzle) return "puzzle inconnu";
      const room: Room = { code: newCode(rooms), players: [], rules: puzzleRules(puzzle), field: puzzleField(puzzle), turnLimit: PUZZLE_TURNS };
      room.onWin = (winner) => {
        if (winner !== 0) return;
        accounts.solvePuzzle(userId, id).then(
          (booster) => send(room.players[0]?.socket, { type: "puzzle_won", id, booster }),
          (error: unknown) => {
            console.error(error);
            send(room.players[0]?.socket, { type: "error", error: "réussite non enregistrée, rejouez le puzzle plus tard" });
          },
        );
      };
      const empty = { main: [], extra: [] };
      return enter(userId, room, empty, { deck: empty, name: "Bot", level: "normal" });
    }

    async function showTower(userId: string): Promise<undefined> {
      send(socket, { type: "tower", ...(await accounts.towerView(userId)) });
      return undefined;
    }

    // The player keeps seat 0 against the bot of the floor. The deck is checked first: an invalid one keeps the progression.
    async function playTower(userId: string): Promise<string | undefined> {
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      const room: Room = { code: newCode(rooms), players: [] };
      const floor = await accounts.startTower(userId);
      towerFloor(room, floor, accounts);
      const { name, main, extra } = TOWER[floor - 1];
      return enter(userId, room, deck, { deck: { main, extra }, name, level: room.level });
    }

    async function sendResults(userId: string): Promise<undefined> {
      send(socket, { type: "duel_results", results: await accounts.duelResults(userId) });
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
      if (isWishMessage(msg)) return manageWishes(user, msg);
      if (isEconomyMessage(msg)) return manageEconomy(user, msg);
      if (isWonderMessage(msg)) return manageWonder(user, msg);
      if (isProfileMessage(msg)) return manageProfile(user, msg);
      if (isSealedMessage(msg)) return manageSealed(user, msg);
      if (msg.type === "booster_state") return sendBoosterState(user);
      if (msg.type === "open_booster") return openBoosterFor(user, msg.set);
      if (msg.type === "admin_boosters") return grantBoosters(user, msg.count);
      if (msg.type === "story") return showStory(user.id);
      if (msg.type === "duel_results") return sendResults(user.id);
      if (msg.type === "event") return showEvent(user.id);
      if (msg.type === "puzzles") return showPuzzles(user.id);
      if (msg.type === "tower") return showTower(user.id);
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (msg.type === "surrender") return seat ? surrender(seat.room, seat.index) : "pas dans une salle";
      if (msg.type === "emote") return seat ? emote(seat.room, seat.index, msg.id) : "pas dans une salle";
      if (msg.type === "report") return seat ? reportBug(seat.room, user.id, msg.message) : "pas dans une salle";
      if (msg.type === "rematch") return seat ? rematch(seat.room, seat.index, msg.accept !== false) : "pas dans une salle";
      if (seat) return "déjà dans une salle";
      if (msg.type === "story_duel") return playStory(user.id, msg.duel, msg.level);
      if (msg.type === "puzzle") return playPuzzle(user.id, msg.id);
      if (msg.type === "tower_duel") return playTower(user.id);
      if (msg.type === "sealed_duel") return playSealed(user.id);
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
