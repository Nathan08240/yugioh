import { randomInt } from "node:crypto";
import { OcgType } from "@n1xx1/ocgcore-wasm";
import { BOOSTERS, creditBoosters, drawPack } from "./boosters.ts";
import { cardInfo } from "./cards.ts";
import { poolCard } from "./collection.ts";
import type { Db } from "./db.ts";
import { COPIES_MAX, countBy, deckError, EXTRA_MAX, isFusion, MAIN_MIN, sameCard } from "./deckcheck.ts";
import type { Printing } from "./pool.ts";
import { type ClientMessage, SEALED_LOSSES, SEALED_REWARDS, SEALED_WINS, type SealedRun, type SealedStatus, type ServerMessage } from "./protocol.ts";

export const SEALED_PACKS = 6;
export type SealedMessage = Extract<ClientMessage, { type: "sealed" | "sealed_start" | "sealed_deck" | "sealed_abandon" }>;

// Sealed session storage, faked in tests.
export type SealedStore = {
  // The latest session, in progress or over.
  sealedRun: (userId: string) => Promise<SealedRun | undefined>;
  // A new session, or the one already in progress.
  startSealed: (userId: string) => Promise<SealedRun>;
  // Resolves to the error when there is no session to build or the deck breaks a rule.
  saveSealedDeck: (userId: string, main: number[], extra: number[]) => Promise<SealedRun | string>;
  // Counts a duel of session `runId`; undefined when the session is not playing anymore.
  sealedResult: (userId: string, runId: number, won: boolean) => Promise<SealedRun | undefined>;
  abandonSealed: (userId: string) => Promise<SealedRun | undefined>;
};

const SEALED_TYPES: ReadonlySet<unknown> = new Set(["sealed", "sealed_start", "sealed_deck", "sealed_abandon"]);
export const isSealedMessage = (msg: ClientMessage): msg is SealedMessage => SEALED_TYPES.has(msg.type);

const isCodes = (value: unknown) => Array.isArray(value) && value.every(Number.isInteger);

// Shape check of an incoming Sealed message (sealed_duel included), before its type is trusted.
export function validSealedMessage(msg: Record<string, unknown>): boolean {
  if (msg.type === "sealed_deck") return isCodes(msg.main) && isCodes(msg.extra);
  return SEALED_TYPES.has(msg.type) || msg.type === "sealed_duel";
}

// The answer to a Sealed message, or the error for the sender.
export async function sealedReply(store: SealedStore, userId: string, msg: SealedMessage): Promise<ServerMessage | string> {
  let run: SealedRun | string | undefined;
  if (msg.type === "sealed") run = await store.sealedRun(userId);
  else if (msg.type === "sealed_start") run = await store.startSealed(userId);
  else if (msg.type === "sealed_deck") run = await store.saveSealedDeck(userId, msg.main, msg.extra);
  else run = await store.abandonSealed(userId);
  return typeof run === "string" ? run : { type: "sealed", run: run ?? null };
}

// Six boosters of one booster set drawn at random, as in openBooster.
export function sealedPool(setCode = [...BOOSTERS.keys()][randomInt(BOOSTERS.size)]): { set: string; cards: Printing[] } {
  const set = BOOSTERS.get(setCode);
  if (!set) throw new Error(`booster inconnu : ${setCode}`);
  return { set: set.code, cards: Array.from({ length: SEALED_PACKS }, () => drawPack(set)).flat() };
}

// The first rule the deck breaks against the session's reserve, or undefined.
export function sealedDeckError(pool: Printing[], main: number[], extra: number[]): string | undefined {
  return deckError({ name: "Scellé", main, extra }, poolCard, countBy(pool.map((card) => card.code)), "la réserve");
}

// The bot's deck from its own reserve of the same set: fusions in the Extra Deck, then the strongest monsters and the spells
// and traps, 3 copies at most, MAIN_MIN cards when the reserve allows it.
// ponytail: ranked on stats only; client/src/constructeur.ts needs browser imports, port it here if the bot must build better.
export function botDeck(setCode: string): { main: number[]; extra: number[] } {
  const cards = sealedPool(setCode).cards.flatMap(({ code }) => {
    const info = cardInfo(code);
    return info ? [{ code, info }] : [];
  });
  const extra = cards.filter(({ info }) => isFusion(info)).map(({ code }) => code).slice(0, EXTRA_MAX);
  const score = ({ info }: (typeof cards)[number]) => {
    // A ritual needs its Ritual Spell: last.
    if ((info.type & OcgType.RITUAL) !== 0) return -1000;
    if ((info.type & (OcgType.SPELL | OcgType.TRAP)) !== 0) return 1500;
    return info.atk - 600 * Math.max(0, Math.ceil((info.level - 4) / 2));
  };
  const copies = new Map<number, number>();
  const main: number[] = [];
  for (const card of cards.filter(({ info }) => !isFusion(info)).sort((a, b) => score(b) - score(a))) {
    const key = sameCard(card.code, card.info);
    if (main.length >= MAIN_MIN || (copies.get(key) ?? 0) >= COPIES_MAX) continue;
    copies.set(key, (copies.get(key) ?? 0) + 1);
    main.push(card.code);
  }
  return { main, extra };
}

type Row = { id: string; set_code: string; pool: number[]; rarities: string[]; deck: number[] | null; extra: number[] | null; wins: number; losses: number; status: SealedStatus };

const view = (row: Row): SealedRun => ({
  id: Number(row.id),
  set: row.set_code,
  setName: BOOSTERS.get(row.set_code)?.name ?? row.set_code,
  pool: row.pool.map((code, i) => ({ code, rarity: row.rarities[i] })),
  main: row.deck,
  extra: row.extra,
  wins: row.wins,
  losses: row.losses,
  status: row.status,
  boosters: row.status === "done" ? SEALED_REWARDS[row.wins] : 0,
});

export async function lastRun(db: Db, userId: string): Promise<SealedRun | undefined> {
  const [row] = await db<Row[]>`select * from yugioh.sealed_runs where user_id = ${userId} order by id desc limit 1`;
  return row && view(row);
}

// The unique index on the sessions in progress keeps a second one out, even when two starts cross.
export async function startRun(db: Db, userId: string): Promise<SealedRun> {
  const { set, cards } = sealedPool();
  await db`
    insert into yugioh.sealed_runs (user_id, set_code, pool, rarities)
    values (${userId}, ${set}, ${cards.map((card) => card.code)}, ${cards.map((card) => card.rarity)})
    on conflict do nothing`;
  return (await lastRun(db, userId)) as SealedRun;
}

// The deck is chosen once, while building: the session then plays with it.
export async function saveRunDeck(db: Db, userId: string, main: number[], extra: number[]): Promise<SealedRun | string> {
  const run = await lastRun(db, userId);
  if (run?.status !== "building") return "aucun deck Scellé à construire";
  const error = sealedDeckError(run.pool, main, extra);
  if (error) return error;
  const [row] = await db<Row[]>`
    update yugioh.sealed_runs set deck = ${main}, extra = ${extra}, status = 'playing'
    where id = ${run.id} and status = 'building' returning *`;
  return row ? view(row) : "aucun deck Scellé à construire";
}

// The row lock counts each duel once; the duel reaching SEALED_WINS or SEALED_LOSSES ends the session and credits its boosters.
export async function recordRunDuel(db: Db, userId: string, runId: number, won: boolean): Promise<SealedRun | undefined> {
  return db.begin(async (sql) => {
    const [row] = await sql<Row[]>`
      select * from yugioh.sealed_runs where id = ${runId} and user_id = ${userId} and status = 'playing' for update`;
    if (!row) return undefined;
    const wins = row.wins + Number(won);
    const losses = row.losses + Number(!won);
    const done = wins >= SEALED_WINS || losses >= SEALED_LOSSES;
    const [updated] = await sql<Row[]>`
      update yugioh.sealed_runs set wins = ${wins}, losses = ${losses}, status = ${done ? "done" : "playing"}, ended_at = ${done ? new Date() : null}
      where id = ${runId} returning *`;
    if (done && SEALED_REWARDS[wins] > 0) await creditBoosters(sql, userId, SEALED_REWARDS[wins]);
    return view(updated);
  });
}

export async function abandonRun(db: Db, userId: string): Promise<SealedRun | undefined> {
  await db`
    update yugioh.sealed_runs set status = 'abandoned', ended_at = now() where user_id = ${userId} and status in ('building', 'playing')`;
  return lastRun(db, userId);
}

export function dbSealedStore(db: Db): SealedStore {
  return {
    sealedRun: (userId) => lastRun(db, userId),
    startSealed: (userId) => startRun(db, userId),
    saveSealedDeck: (userId, main, extra) => saveRunDeck(db, userId, main, extra),
    sealedResult: (userId, runId, won) => recordRunDuel(db, userId, runId, won),
    abandonSealed: (userId) => abandonRun(db, userId),
  };
}
