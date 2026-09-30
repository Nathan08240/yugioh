import { BOOSTERS, creditBoosters } from "./boosters.ts";
import { addCards, readCollection, readRarities, type DeckStore } from "./collection.ts";
import type { Db } from "./db.ts";
import { KEEP_COPIES, type ClientMessage, type ServerMessage } from "./protocol.ts";

// From the lowest rarity: points of a converted copy, cost of a card whose best booster rarity it is.
const RARITY_TABLE: [rarity: string, points: number, cost: number][] = [
  ["common", 5, 40],
  ["shortprint", 5, 40],
  ["rare", 20, 100],
  ["super", 50, 250],
  ["ultra", 100, 500],
  ["ultimate", 200, 1000],
  ["secret", 200, 1000],
];
const RANK = new Map(RARITY_TABLE.map(([rarity], index) => [rarity, index]));
// A copy of unknown rarity ("") counts as a common, and goes first.
const pointsOf = (rarity: string) => RARITY_TABLE[RANK.get(rarity) ?? 0][1];
const rank = (rarity: string) => RANK.get(rarity) ?? -1;

// Best rarity of each card in the boosters, which sets its cost. Cards found only in starter decks cannot be obtained.
const best = new Map<number, number>();
for (const card of [...BOOSTERS.values()].flatMap((set) => set.cards)) best.set(card.code, Math.max(best.get(card.code) ?? 0, rank(card.rarity)));
export const CRAFT_COSTS: ReadonlyMap<number, number> = new Map([...best].map(([code, index]) => [code, RARITY_TABLE[index][2]]));

export type Conversion = Omit<Extract<ServerMessage, { type: "conversion" }>, "type">;

// Copies past KEEP_COPIES of each card as [passcode, rarity, quantity], the lowest rarities first ("": unknown rarity).
export function conversionPlan(cards: [number, number][], rarities: [number, string, number][]): Conversion {
  const known = Map.groupBy(rarities, ([code]) => code);
  const plan: [number, string, number][] = [];
  for (const [code, quantity] of cards) {
    let excess = quantity - KEEP_COPIES;
    if (excess <= 0) continue;
    const copies = (known.get(code) ?? []).map(([, rarity, count]): [string, number] => [rarity, count]).sort(([a], [b]) => rank(a) - rank(b));
    copies.unshift(["", quantity - copies.reduce((sum, [, count]) => sum + count, 0)]);
    for (const [rarity, count] of copies) {
      const taken = Math.min(count, excess);
      if (taken <= 0) continue;
      plan.push([code, rarity, taken]);
      excess -= taken;
    }
  }
  return { cards: plan, points: plan.reduce((sum, [, rarity, count]) => sum + count * pointsOf(rarity), 0) };
}

export const previewConversion = async (db: Db, userId: string): Promise<Conversion> =>
  conversionPlan(await readCollection(db, userId), await readRarities(db, userId));

// Converts the duplicates if they still give `expected` points, the preview the player confirmed. The profile lock
// serializes conversions and cards obtained with points, the collection locks keep boosters from changing the copies meanwhile.
export async function convertDuplicates(db: Db, userId: string, expected: number): Promise<string | undefined> {
  return db.begin(async (sql) => {
    await sql`select 1 from yugioh.profiles where user_id = ${userId} for update`;
    await sql`select 1 from yugioh.collection where user_id = ${userId} for update`;
    await sql`select 1 from yugioh.collection_rarities where user_id = ${userId} for update`;
    const { cards, points } = conversionPlan(await readCollection(sql, userId), await readRarities(sql, userId));
    if (cards.length === 0) return "aucun doublon à convertir";
    if (points !== expected) return "la collection a changé, relancez l'aperçu";
    const byCard = Map.groupBy(cards, ([code]) => code);
    const counts = [...byCard.values()].map((rows) => rows.reduce((sum, [, , count]) => sum + count, 0));
    await sql`
      update yugioh.collection c set quantity = c.quantity - x.n
      from unnest(${[...byCard.keys()]}::integer[], ${counts}::integer[]) x (code, n) where c.user_id = ${userId} and c.card_code = x.code`;
    const known = cards.filter(([, rarity]) => rarity !== "");
    const [codes, rarities, quantities] = [known.map(([code]) => code), known.map(([, rarity]) => rarity), known.map(([, , count]) => count)];
    // Rows taken whole go first: a row left with as many copies as another one taken must stay.
    await sql`
      delete from yugioh.collection_rarities r using unnest(${codes}::integer[], ${rarities}::text[], ${quantities}::integer[]) x (code, rarity, n)
      where r.user_id = ${userId} and r.card_code = x.code and r.rarity = x.rarity and r.quantity = x.n`;
    await sql`
      update yugioh.collection_rarities r set quantity = r.quantity - x.n
      from unnest(${codes}::integer[], ${rarities}::text[], ${quantities}::integer[]) x (code, rarity, n)
      where r.user_id = ${userId} and r.card_code = x.code and r.rarity = x.rarity and r.quantity > x.n`;
    await sql`update yugioh.profiles set collection_points = collection_points + ${points} where user_id = ${userId}`;
    const gains = cards.map(([, rarity, count]) => count * pointsOf(rarity));
    await sql`
      insert into yugioh.collection_exchanges (user_id, kind, card_code, rarity, quantity, points)
      select ${userId}::uuid, 'convert', code, nullif(rarity, ''), n, points
      from unnest(${cards.map(([code]) => code)}::integer[], ${cards.map(([, rarity]) => rarity)}::text[], ${cards.map(([, , count]) => count)}::integer[], ${gains}::integer[]) x (code, rarity, n, points)`;
    return undefined;
  });
}

// One Common copy of a booster card, for players holding fewer than KEEP_COPIES copies of it.
export async function craftCard(db: Db, userId: string, code: number): Promise<string | undefined> {
  const cost = CRAFT_COSTS.get(code);
  if (cost === undefined) return "carte introuvable dans les boosters";
  return db.begin(async (sql) => {
    const [profile] = await sql<{ points: number }[]>`
      select collection_points as points from yugioh.profiles where user_id = ${userId} for update`;
    const [owned] = await sql<{ quantity: number }[]>`
      select quantity from yugioh.collection where user_id = ${userId} and card_code = ${code} for update`;
    if ((owned?.quantity ?? 0) >= KEEP_COPIES) return `déjà ${KEEP_COPIES} exemplaires de cette carte`;
    if (!profile || profile.points < cost) return `points insuffisants : ${cost} nécessaires`;
    await sql`update yugioh.profiles set collection_points = collection_points - ${cost} where user_id = ${userId}`;
    await addCards(sql, userId, [{ code, rarity: "common" }]);
    await sql`
      insert into yugioh.collection_exchanges (user_id, kind, card_code, rarity, quantity, points)
      values (${userId}, 'craft', ${code}, 'common', 1, ${-cost})`;
    return undefined;
  });
}

export const DAILY_BOOSTERS = 1;
// "2026-09-30": the calendar day in France, which starts the daily reward and the replay booster limit.
export const parisDay = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

// True for the first call of the day only, even from concurrent connections: the update locks the profile row.
export async function claimDaily(db: Db, userId: string): Promise<boolean> {
  const today = parisDay();
  return db.begin(async (sql) => {
    const [row] = await sql`
      update yugioh.profiles set daily_on = ${today}::date
      where user_id = ${userId} and daily_on is distinct from ${today}::date returning user_id`;
    if (row) await creditBoosters(sql, userId, DAILY_BOOSTERS);
    return row !== undefined;
  });
}

export type EconomyMessage = Extract<ClientMessage, { type: "convert_preview" | "convert" | "craft" }>;

// Points storage, faked in tests.
export type EconomyStore = {
  previewConversion: (userId: string) => Promise<Conversion>;
  // Resolve to the error for the player, if any.
  convertDuplicates: (userId: string, expected: number) => Promise<string | undefined>;
  craftCard: (userId: string, code: number) => Promise<string | undefined>;
  // True for the first connection of the day, which earns DAILY_BOOSTERS.
  claimDaily: (userId: string) => Promise<boolean>;
};

const ECONOMY_TYPES: ReadonlySet<unknown> = new Set(["convert_preview", "convert", "craft"]);
export const isEconomyMessage = (msg: ClientMessage): msg is EconomyMessage => ECONOMY_TYPES.has(msg.type);

// Shape check of an incoming points message, before its type is trusted.
export const validEconomyMessage = (msg: Record<string, unknown>): boolean =>
  msg.type === "convert_preview" || (msg.type === "convert" && Number.isInteger(msg.points)) || (msg.type === "craft" && Number.isInteger(msg.code));

// A conversion preview, else the collection once converted or crafted; or the error for the sender.
export async function economyReply(
  store: EconomyStore & Pick<DeckStore, "collection">,
  userId: string,
  msg: EconomyMessage,
): Promise<ServerMessage | string> {
  if (msg.type === "convert_preview") return { type: "conversion", ...(await store.previewConversion(userId)) };
  const error = msg.type === "convert" ? await store.convertDuplicates(userId, msg.points) : await store.craftCard(userId, msg.code);
  return error ?? { type: "collection", ...(await store.collection(userId)) };
}

export function dbEconomyStore(db: Db): EconomyStore {
  return {
    previewConversion: (userId) => previewConversion(db, userId),
    convertDuplicates: (userId, expected) => convertDuplicates(db, userId, expected),
    craftCard: (userId, code) => craftCard(db, userId, code),
    claimDaily: (userId) => claimDaily(db, userId),
  };
}
