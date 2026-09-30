import { randomInt } from "node:crypto";
import { BOOSTERS, drawPack } from "./boosters.ts";
import { addCards } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import type { Printing } from "./pool.ts";
import type { ClientMessage, ServerMessage, WonderView } from "./protocol.ts";

export const WONDER_CARDS = 5;
export type WonderMessage = Extract<ClientMessage, { type: "wonder" | "wonder_draw" | "wonder_pick" }>;

// Wonder pick storage, faked in tests.
export type WonderStore = {
  wonder: (userId: string) => Promise<WonderView>;
  // Draws the cards of the day, or gives back the draw already made.
  wonderDraw: (userId: string) => Promise<WonderView>;
  // Resolves to an error for the sender: no draw today, already picked.
  wonderPick: (userId: string, index: number) => Promise<WonderView | string>;
};

const WONDER_TYPES: ReadonlySet<unknown> = new Set(["wonder", "wonder_draw", "wonder_pick"]);
export const isWonderMessage = (msg: ClientMessage): msg is WonderMessage => WONDER_TYPES.has(msg.type);

const validIndex = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < WONDER_CARDS;

// Shape check of an incoming wonder pick message, before its type is trusted.
export const validWonderMessage = (msg: Record<string, unknown>): boolean =>
  msg.type === "wonder" || msg.type === "wonder_draw" || (msg.type === "wonder_pick" && validIndex(msg.index));

// The answer to a wonder pick message, or the error for the sender.
export async function wonderReply(store: WonderStore, userId: string, msg: WonderMessage): Promise<ServerMessage | string> {
  let view: WonderView | string;
  if (msg.type === "wonder_draw") view = await store.wonderDraw(userId);
  else if (msg.type === "wonder_pick") view = await store.wonderPick(userId, msg.index);
  else view = await store.wonder(userId);
  return typeof view === "string" ? view : { type: "wonder", ...view };
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// A virtual booster of a random set, as openBooster draws it: 5 of its cards, then the order of the face-down cards.
export function drawWonder(): { set: string; cards: Printing[]; shuffle: number[] } {
  const sets = [...BOOSTERS.values()];
  const set = sets[randomInt(sets.length)];
  const cards = shuffled(drawPack(set)).slice(0, WONDER_CARDS);
  return { set: set.code, cards, shuffle: shuffled(cards.map((_, i) => i)) };
}

type Row = { cards: number[]; rarities: string[]; shuffle: number[]; picked: number | null };

function view(row: Row | undefined): WonderView {
  if (!row) return { status: "available" };
  const cards = row.cards.map((code, i) => ({ code, rarity: row.rarities[i] }));
  if (row.picked === null) return { status: "drawn", cards };
  return { status: "picked", cards, shuffle: row.shuffle, picked: row.picked };
}

// The day changes at midnight in Paris.
async function readToday(sql: Sql, userId: string): Promise<WonderView> {
  const [row] = await sql<Row[]>`
    select cards, rarities, shuffle, picked from yugioh.wonder_picks
    where user_id = ${userId} and day = (now() at time zone 'Europe/Paris')::date`;
  return view(row);
}

// The primary key keeps one draw per day: a concurrent or later draw reads the one stored.
export async function wonderDraw(db: Db, userId: string): Promise<WonderView> {
  const { set, cards, shuffle } = drawWonder();
  const codes = cards.map((card) => card.code);
  const rarities = cards.map((card) => card.rarity);
  return db.begin(async (sql) => {
    await sql`
      insert into yugioh.wonder_picks (user_id, set_code, cards, rarities, shuffle) values (${userId}, ${set}, ${codes}, ${rarities}, ${shuffle})
      on conflict (user_id, day) do nothing`;
    return readToday(sql, userId);
  });
}

// The row lock makes concurrent picks wait for each other: only the first one adds a card.
export async function wonderPick(db: Db, userId: string, index: number): Promise<WonderView | string> {
  return db.begin(async (sql) => {
    const [row] = await sql<Row[]>`
      select cards, rarities, shuffle, picked from yugioh.wonder_picks
      where user_id = ${userId} and day = (now() at time zone 'Europe/Paris')::date for update`;
    if (!row) return "aucune pioche miracle en cours";
    if (row.picked !== null) return "carte déjà choisie";
    const rank = row.shuffle[index];
    await addCards(sql, userId, [{ code: row.cards[rank], rarity: row.rarities[rank] }]);
    await sql`
      update yugioh.wonder_picks set picked = ${index}, picked_at = now()
      where user_id = ${userId} and day = (now() at time zone 'Europe/Paris')::date`;
    return view({ ...row, picked: index });
  });
}

export function dbWonderStore(db: Db): WonderStore {
  return {
    wonder: (userId) => readToday(db, userId),
    wonderDraw: (userId) => wonderDraw(db, userId),
    wonderPick: (userId, index) => wonderPick(db, userId, index),
  };
}
