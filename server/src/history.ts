import { OcgMessageType, OcgProcessResult, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import type postgres from "postgres";
import type { Db } from "./db.ts";
import { fieldMoves, fieldStats, lpOf, openDuel, type Seed } from "./duel.ts";
import type { DuelEvent, HistoryMode, ReplayEmote, ReplaySummary, Seat, ServerMessage } from "./protocol.ts";
import type { Report } from "./report.ts";
import { engineForm } from "./respond.ts";
import { ANSWERS, type Room } from "./room.ts";
import { visibleTo } from "./visibility.ts";

// Finished duels kept per player, the oldest deleted first.
export const HISTORY_MAX = 20;
const MAX_STEPS = 20_000;
// Each replay reruns a whole duel in the engine: REPLAYS_PER_MINUTE asked per player at most.
export const REPLAYS_PER_MINUTE = 5;
export const REPLAYS_LIMITED = "trop de duels revus d'un coup, réessayez dans une minute";

// Counts a replay asked by `userId` in `asked` (times by player), false when they already asked REPLAYS_PER_MINUTE this last minute.
export function replayAllowed(asked: Map<string, number[]>, userId: string, now = Date.now()): boolean {
  const recent = (asked.get(userId) ?? []).filter((at) => now - at < 60_000);
  const allowed = recent.length < REPLAYS_PER_MINUTE;
  if (allowed) recent.push(now);
  asked.set(userId, recent);
  return allowed;
}

// A bug report of the finished duel (report.ts) and how it ended, which the server may have decided (surrender, clock).
// A bug report of a duel in progress has no `end`: it is played up to its last response.
export type Replay = Report & { end?: { winner: number; reason: number } };
export type HistoryEntry = { userId: string; seat: Seat; mode: HistoryMode; opponent: string | null; won: boolean | null; replay: Replay };
export type StoredReplay = Pick<HistoryEntry, "seat" | "opponent" | "replay">;

export function historyMode(room: Room): HistoryMode {
  if (room.ranked) return "ranked";
  if (room.event) return "event";
  if (room.tower) return "tower";
  if (room.forfeit === "Scellé") return "sealed";
  if (room.forfeit === "Draft") return "draft";
  if (room.field) return room.turnLimit === undefined ? "tutorial" : "puzzle";
  if (room.mode?.mode === "story") return "story";
  return room.players.some((player) => player.bot) ? "bot" : "online";
}

// The entry of the duel for the human at `seat`; `won` is null for a draw.
export function historyEntry(room: Room, report: Report, seat: Seat, winner: number, reason: number): HistoryEntry {
  const won = winner === 0 || winner === 1 ? winner === seat : null;
  const opponent = room.players[1 - seat]?.name ?? null;
  return { userId: room.players[seat].id, seat, mode: historyMode(room), opponent, won, replay: { ...report, end: { winner, reason } } };
}

export async function saveReplay(db: Db, { userId, seat, mode, opponent, won, replay }: HistoryEntry): Promise<void> {
  await db.begin(async (sql) => {
    await sql`
      insert into yugioh.duel_replays (user_id, seat, mode, opponent, won, payload)
      values (${userId}, ${seat}, ${mode}, ${opponent}, ${won}, ${sql.json(replay as unknown as postgres.JSONValue)})`;
    await sql`
      delete from yugioh.duel_replays where user_id = ${userId}
      and id not in (select id from yugioh.duel_replays where user_id = ${userId} order by id desc limit ${HISTORY_MAX})`;
  });
}

export async function listReplays(db: Db, userId: string): Promise<ReplaySummary[]> {
  const rows = await db<{ id: string; date: Date; mode: HistoryMode; opponent: string | null; won: boolean | null }[]>`
    select id, played_at as date, mode, opponent, won from yugioh.duel_replays where user_id = ${userId} order by id desc limit ${HISTORY_MAX}`;
  return rows.map((row) => ({ ...row, id: Number(row.id), date: row.date.toISOString() }));
}

// Only a duel of this player.
export async function readReplay(db: Db, userId: string, id: number): Promise<StoredReplay | undefined> {
  const [row] = await db<{ seat: Seat; opponent: string | null; payload: Replay }[]>`
    select seat, opponent, payload from yugioh.duel_replays where user_id = ${userId} and id = ${id}`;
  return row && { seat: row.seat, opponent: row.opponent, replay: row.payload };
}

// Index of the event where the duel stopped: the first WIN, or the NEW_TURN past the `turn` turns the players saw (a failed puzzle).
function stopAt(events: readonly OcgMessage[], turns: { seen: number; max: number }): number {
  return events.findIndex((msg) => {
    if (msg.type === OcgMessageType.NEW_TURN) turns.seen++;
    return msg.type === OcgMessageType.WIN || turns.seen > turns.max;
  });
}

// Runs the engine on the recorded responses, as advance() did, and hands each batch to `show`; `asked` is called at each
// question, before its response goes in. False when the server ended the duel.
function rerun(duel: Awaited<ReturnType<typeof openDuel>>, replay: Replay, show: (messages: OcgMessage[]) => void, asked: () => void): boolean {
  const { lib, handle } = duel;
  const turns = { seen: 0, max: replay.end ? replay.turn : Infinity };
  const end: OcgMessage = { type: OcgMessageType.WIN, player: replay.end?.winner ?? 0, reason: replay.end?.reason ?? 0 };
  let next = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    const events = messages.filter((msg) => !ANSWERS.has(msg.type));
    const stop = stopAt(events, turns);
    if (stop !== -1) {
      show(events[stop].type === OcgMessageType.WIN ? events.slice(0, stop + 1) : [...events.slice(0, stop), end]);
      return true;
    }
    show(events);
    if (status === OcgProcessResult.END) return true;
    const question = messages.at(-1);
    if (status !== OcgProcessResult.WAITING || !question || !("player" in question)) continue;
    asked();
    const response = replay.responses[next++];
    if (!response) return false;
    lib.duelSetResponse(handle, engineForm(response));
  }
  return false;
}

// What `seat` was sent during the duel, batch by batch as broadcast() sent it, stats included: never more than the player saw.
// The emotes come with the number of batches shown when each was sent, found by the question the engine awaited then.
export async function replayBatches(replay: Replay, seat: Seat): Promise<{ batches: DuelEvent[][]; emotes: ReplayEmote[] }> {
  const seed = replay.seed.map(BigInt) as Seed;
  const main = replay.decks.map((deck) => deck.main);
  const extras = replay.decks.map((deck) => deck.extra);
  const duel = await openDuel(seed, main, () => {}, undefined, replay.rules, extras, replay.field);
  const batches: DuelEvent[][] = [];
  const questions: number[] = [];
  let last: string | undefined;
  const show = (messages: OcgMessage[]) => {
    const events: DuelEvent[] = messages.flatMap((msg) => visibleTo(msg, seat) ?? []);
    const stats = fieldStats(duel, seat);
    const key = JSON.stringify(stats);
    if (events.length === 0 && key === last) return;
    last = key;
    batches.push([...events, stats]);
  };
  try {
    if (replay.field) show(fieldMoves(replay.field));
    if (!rerun(duel, replay, show, () => questions.push(batches.length)) && replay.end) show([{ type: OcgMessageType.WIN, player: replay.end.winner, reason: replay.end.reason }]);
  } finally {
    duel.lib.destroyDuel(duel.handle);
  }
  const emotes = (replay.emotes ?? []).map(({ seat: from, id, step }) => ({ at: questions[step] ?? batches.length, seat: from, id }));
  return { batches, emotes };
}

export async function replayMessage({ seat, opponent, replay }: StoredReplay, id: number): Promise<Extract<ServerMessage, { type: "replay" }>> {
  const lp = lpOf(replay.rules, seat);
  const opponentLp = lpOf(replay.rules, 1 - seat);
  const [first, second] = replay.decks;
  const { batches, emotes } = await replayBatches(replay, seat);
  return {
    type: "replay",
    id,
    seat,
    lp,
    opponentLp: opponentLp === lp ? undefined : opponentLp,
    decks: [first.main.length + replay.rules.cards.length, second.main.length],
    extras: [first.extra.length, second.extra.length],
    opponent: opponent ?? undefined,
    batches,
    emotes,
  };
}
