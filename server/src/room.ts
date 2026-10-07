import { randomInt } from "node:crypto";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { WebSocket } from "ws";
import { announceCard, declarable, declarableFromDeck } from "./announce.ts";
import type { Bot } from "./bot.ts";
import { agreeToRules, fieldMonsters, fieldMoves, fieldStats, lpOf, openDuel, STANDARD_RULES, type FieldMonsters, type Placed, type Rules, type Seed } from "./duel.ts";
import { EMOTE_DELAY, type EmoteId } from "./emotes.ts";
import type { WeeklyEvent } from "./event.ts";
import { countEvents, newTally, type Tally } from "./missions.ts";
import { PUZZLE_FAILED, type BotLevel, type DuelEvent, type RoomOptions, type Seat, type ServerMessage } from "./protocol.ts";
import { RESPONSE_BYTES, type Report } from "./report.ts";
import { engineForm, respond } from "./respond.ts";
import type { DuelResult } from "./results.ts";
import { hideCards, visibleTo } from "./visibility.ts";
import { send, sendEach } from "./wire.ts";

type Question = Extract<OcgMessage, { player: number }>;
// `stats`: the last stats event sent, as JSON.
// `gone`: the player lost their connection during an online duel and loses it at `at` unless they come back.
export type Player = { id: string; name?: string; avatar?: number; socket?: WebSocket; log: DuelEvent[]; deck: readonly number[]; deckId?: number; extra?: readonly number[]; bot?: Bot; stats?: string; gone?: { at: number; timer: NodeJS.Timeout } };
// Time `left` to the asked seat of an online duel, counting down from `since` while `timer` runs (paused while they are disconnected).
type Clock = { seat: Seat; left: number; since: number; timer?: NodeJS.Timeout };
export type Room = {
  code: string;
  players: Player[];
  // STANDARD_RULES when absent.
  rules?: Rules;
  // The event of the week this room plays under: its `rules` are the event's.
  event?: WeeklyEvent;
  // The custom rules of a private room or of a challenge: its `rules` are built from them.
  options?: RoomOptions;
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
  onWatch?: () => void;
  // Sealed or Draft mode, whose screen starts the next duel: a duel still running when the room expires is lost by seat 0.
  forfeit?: "Scellé" | "Draft";
  // A ranked duel: its end updates both ratings, and it has no rematch.
  ranked?: true;
  // What a bug report needs to replay the current (or last) duel: its seed, decks, turn and every response the engine accepted.
  record?: { seed: Seed; decks: Report["decks"]; turn: number; responses: OcgResponse[]; emotes: NonNullable<Report["emotes"]> };
  // Tower mode: the floor of the duel, and the recording of its win once seat 0 won.
  tower?: { floor: number; saved?: Promise<void> };
  // Online duel between two players only: what the spectators get (the public log, rebuilt for each duel) and their sockets.
  watch?: { log: DuelEvent[]; stats?: string; sockets: WebSocket[] };
  // Summons and damage of the current duel, for the daily missions.
  tally?: Tally;
};

// Point of view of a spectator, who sits at no seat: hideCards and visibleTo then hide the cards of both players.
const SPECTATOR = -1;

export const rulesOf = (room: Room) => room.rules ?? STANDARD_RULES;
// Main deck sizes the engine never sends: the Extra Rules cards sit in player 0's deck until they remove themselves.
export const deckSizes = (room: Room): [number, number] => [
  (room.players[0]?.deck.length ?? 0) + rulesOf(room).cards.length,
  room.players[1]?.deck.length ?? 0,
];
export const extraSizes = (room: Room): [number, number] => [room.players[0]?.extra?.length ?? 0, room.players[1]?.extra?.length ?? 0];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// In an online duel between two players: time to answer a question of the engine, and to come back after a lost connection.
export const DECISION_TIME = 2 * 60_000;
export const RECONNECT_TIME = 2 * 60_000;
// WIN reasons of the ends decided by the server, as EDOPro numbers them.
export const SURRENDER = 0;
export const TIME_LIMIT = 3;
export const CONNECTION_LOST = 4;

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

export const randomSeed = (): Seed => [...crypto.getRandomValues(new BigUint64Array(4))] as Seed;

export function ask(room: Room, retry: boolean) {
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
    const announce = question.type === OcgMessageType.ANNOUNCE_CARD ? { announce: declarable(question.opcodes), announceDeck: declarableFromDeck(question.opcodes, player?.deck ?? []) } : {};
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
      const own = retry || question.type === OcgMessageType.ANNOUNCE_CARD;
      answer(room, asked.player as Seat, own ? respond(question, (opcodes) => announceCard(opcodes, player.deck)) : bot.answer(question, player.log));
    } catch (error) {
      fail(room, `bot sans réponse : ${error}`);
    }
  }, bot.delay).unref();
}

// What `viewer` may see of these messages, followed by the monster stats as the engine left them; undefined when nothing changed for them.
function visibleEvents(duel: NonNullable<Room["duel"]>, messages: OcgMessage[], viewer: number, monsters: FieldMonsters, lastStats?: string) {
  const events: DuelEvent[] = messages.flatMap((msg) => visibleTo(msg, viewer) ?? []);
  const stats = fieldStats(duel, viewer, monsters);
  const key = JSON.stringify(stats);
  if (events.length === 0 && key === lastStats) return undefined;
  events.push(stats);
  return { events, key };
}

// The messages each player and the spectators may see. A bot gets its events as they come and keeps no log.
function broadcast(room: Room, duel: NonNullable<Room["duel"]>, messages: OcgMessage[]) {
  const monsters = fieldMonsters(duel);
  room.players.forEach((player, seat) => {
    const shown = visibleEvents(duel, messages, seat, monsters, player.stats);
    if (!shown) return;
    player.stats = shown.key;
    if (player.bot) player.bot.see(shown.events);
    else player.log.push(...shown.events);
    send(player.socket, { type: "messages", messages: shown.events });
  });
  const { watch } = room;
  const shown = watch && visibleEvents(duel, messages, SPECTATOR, monsters, watch.stats);
  if (!watch || !shown) return;
  watch.stats = shown.key;
  watch.log.push(...shown.events);
  sendEach(watch.sockets, { type: "messages", messages: shown.events });
}

export function endDuel(room: Room) {
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
export function finish(room: Room, winner: Seat, reason: number) {
  if (!room.duel) return;
  broadcast(room, room.duel, [{ type: OcgMessageType.WIN, player: winner, reason }]);
  room.onWin?.(winner);
  room.onEnd?.(winner, reason);
  endDuel(room);
}

export function surrender(room: Room, seat: Seat): string | undefined {
  if (!room.duel) return "aucun duel en cours";
  finish(room, (1 - seat) as Seat, SURRENDER);
  return undefined;
}

export const online = (room: Room) => room.players.length === 2 && !room.players.some((player) => player.bot);
export const sendAll = (room: Room, data: ServerMessage) => sendEach([...room.players.map((player) => player.socket), ...(room.watch?.sockets ?? [])], data);

// The report of the current or last duel of the room, undefined before it started.
export function reportOf(room: Room): Report | undefined {
  const { record } = room;
  if (!record) return undefined;
  let mode: Report["mode"] = "bot";
  if (online(room)) mode = "online";
  else if (room.field) mode = "puzzle";
  else if (room.mode?.mode === "story") mode = "histoire";
  return { mode, room: room.code, turn: record.turn, date: new Date().toISOString(), level: room.level, seed: record.seed.map(String), rules: rulesOf(room), decks: record.decks, field: room.field, responses: record.responses, emotes: record.emotes };
}

// When each player last sent an emote, in ms since the epoch.
const lastEmote = new WeakMap<Player, number>();

// Relays an emote to both seats; one sent less than EMOTE_DELAY after the previous one is dropped.
export function emote(room: Room, seat: Seat, id: EmoteId): string | undefined {
  const player = room.players[seat];
  if (!room.duel) return "aucun duel en cours";
  const now = Date.now();
  if (now - (lastEmote.get(player) ?? -Infinity) < EMOTE_DELAY) return undefined;
  lastEmote.set(player, now);
  room.record?.emotes.push({ seat, id, step: room.record.responses.length });
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
export function away(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (!room.duel || !online(room) || !player || player.gone) return;
  if (room.decision?.seat === seat) pauseClock(room);
  player.gone = { at: Date.now() + RECONNECT_TIME, timer: setTimeout(() => finish(room, (1 - seat) as Seat, CONNECTION_LOST), RECONNECT_TIME).unref() };
  sendAll(room, { type: "timer", kind: "reconnect", seat, ms: RECONNECT_TIME });
}

// The player is back: their clock resumes, and they get the clocks still running.
export function back(room: Room, seat: Seat) {
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

export function fail(room: Room, error: string, shown = "le moteur a rencontré une erreur, salle fermée") {
  console.error(`[salle ${room.code}] ${error}`);
  sendAll(room, { type: "duel_error", error: shown });
  endDuel(room);
}

// The online rematch pending, if any, for a seat that comes back.
export function rematchMessage(room: Room): ServerMessage | undefined {
  if (room.rematch === undefined) return undefined;
  return room.rematch === "declined" ? { type: "rematch_declined" } : { type: "rematch", from: room.rematch };
}

export function declineRematch(room: Room) {
  room.rematch = "declined";
  sendAll(room, { type: "rematch_declined" });
}

function joinedMessage(room: Room, seat: Seat, log: DuelEvent[]): Extract<ServerMessage, { type: "joined" }> {
  const [lp, opponentLp] = [lpOf(rulesOf(room), seat), lpOf(rulesOf(room), 1 - seat)];
  const rule = room.event?.rule ?? room.options?.rule;
  return { type: "joined", room: room.code, seat, lp, opponentLp: opponentLp === lp ? undefined : opponentLp, decks: deckSizes(room), extras: extraSizes(room), opponent: room.players[1 - seat]?.name, opponentAvatar: room.players[1 - seat]?.avatar, special: rule ? [rule] : undefined, options: room.options, log, floor: room.tower?.floor };
}

export function sendJoined(room: Room, seat: Seat) {
  const player = room.players[seat];
  if (player) send(player.socket, joinedMessage(room, seat, player.log));
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

// A spectator sees the duel from seat 0, through the public log.
export function sendWatching(room: Room, socket: WebSocket) {
  const [first] = room.players;
  send(socket, { ...joinedMessage(room, 0, room.watch?.log ?? []), spectating: { name: first?.name, avatar: first?.avatar } });
}

export const sendSpectators = (room: Room) => sendAll(room, { type: "spectators", count: room.watch?.sockets.length ?? 0 });

// Runs the engine until it asks a question or the duel ends. A crash inside the engine closes only this room.
export function advance(room: Room) {
  const { duel } = room;
  if (!duel) return;
  let running = true;
  while (running) running = step(room, duel);
}

// One run of the engine: false once it asks a question, the duel ends or the engine fails.
function step(room: Room, duel: NonNullable<Room["duel"]>): boolean {
  const { lib, handle } = duel;
  let status: OcgProcessResult;
  let messages: OcgMessage[];
  try {
    status = lib.duelProcess(handle);
    messages = lib.duelGetMessage(handle);
  } catch (error) {
    fail(room, `erreur moteur : ${error}`);
    return false;
  }
  if (messages.some((msg) => msg.type === OcgMessageType.RETRY)) {
    // The engine refused the last response: the replay must not send it.
    room.record?.responses.pop();
    ask(room, true);
    return false;
  }
  const events = limitTurns(room, messages.filter((msg) => !ANSWERS.has(msg.type)));
  const turns = events.filter((msg) => msg.type === OcgMessageType.NEW_TURN).length;
  room.turns = (room.turns ?? 0) + turns;
  if (room.record) room.record.turn += turns;
  if (room.tally) countEvents(room.tally, events);
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
    return false;
  }
  const last = messages.at(-1);
  if (status === OcgProcessResult.WAITING && last && "player" in last) {
    clearTimeout(room.decision?.timer);
    room.decision = online(room) ? { seat: last.player as Seat, left: DECISION_TIME, since: 0 } : undefined;
    runClock(room);
    room.question = last;
    ask(room, false);
    return false;
  }
  return true;
}

// Returns an error for the sender, if any. A response the engine cannot take is asked again.
export function answer(room: Room, seat: Seat, response: OcgResponse): string | undefined {
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

// Captures the room code only: the engine binding never releases the callbacks of a duel, a captured room would stay in memory.
const engineErrors = (code: string) => (text: string) => console.error(`[salle ${code}] ${text}`);

export async function start(room: Room, seed: Seed) {
  const decks = room.players.map((player) => player.deck);
  const extras = room.players.map((player) => player.extra ?? []);
  room.turns = 0;
  room.tally = newTally();
  if (online(room)) {
    room.watch = { log: [], sockets: room.watch?.sockets ?? [] };
    room.watch.sockets.forEach((socket) => sendWatching(room, socket));
    room.onWatch?.();
  }
  room.record = { seed, decks: decks.map((main, seat) => ({ main: [...main], extra: [...extras[seat]] })), turn: 0, responses: [], emotes: [] };
  room.duel = await openDuel(seed, decks, engineErrors(room.code), undefined, rulesOf(room), extras, room.field);
  if (room.field) broadcast(room, room.duel, fieldMoves(room.field));
  advance(room);
}

export function newCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}
