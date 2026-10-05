import { randomInt } from "node:crypto";
import { addCards } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import { type CardSet, type Printing, SETS, type Slot } from "./pool.ts";

export const FREE_BOOSTER_HOURS = 12;
// Won by the victor of an online duel between two players (not a bot duel).
export const WIN_BOOSTER_REWARD = 1;
export const BOOSTERS: ReadonlyMap<string, CardSet> = new Map(SETS.filter((set) => set.slots).map((set) => [set.code, set]));

type Group = { chance?: number; cards: Printing[] };

const random = () => randomInt(2 ** 47) / 2 ** 47;

function pick<T>(items: T[], weight: (item: T) => number): T {
  let roll = random() * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items.at(-1) as T;
}

// Proportionate slots weigh each card (a shortprint is 3 times rarer than a common),
// others give each group its 1:chance odd and share the rest between groups without chance.
function weights(slot: Slot, groups: Group[]): (group: Group) => number {
  if (slot.proportionate) return (group) => group.cards.length / (group.chance ?? 1);
  const rest = 1 - groups.reduce((sum, group) => sum + (group.chance ? 1 / group.chance : 0), 0);
  const fallbacks = groups.filter((group) => !group.chance).length;
  return (group) => (group.chance ? 1 / group.chance : rest / fallbacks);
}

// No printing twice in a pack; a rarity missing from the set leaves its odds to the fallback group.
function drawCard(set: CardSet, slot: Slot, pack: Set<Printing>): Printing {
  const groups = slot.rarity
    .map(({ rarities, chance }) => ({ chance, cards: set.cards.filter((card) => rarities.includes(card.rarity) && !pack.has(card)) }))
    .filter((group) => group.cards.length > 0);
  const { cards } = pick(groups, weights(slot, groups));
  return cards[randomInt(cards.length)];
}

export function drawPack(set: CardSet): Printing[] {
  const pack = new Set<Printing>();
  for (const slot of set.slots ?? []) {
    for (let i = 0; i < (slot.qty ?? 1); i++) pack.add(drawCard(set, slot, pack));
  }
  return [...pack];
}

// Boosters opened in a row without an Ultra Rare or better, after which the next one holds one.
export const ULTRA_PITY = 20;
const ULTRA = new Set(["ultra", "ultimate", "secret"]);
export const hasUltra = (pack: Printing[]) => pack.some((card) => ULTRA.has(card.rarity));

// A pack holding an Ultra Rare or better, with the odds of the set otherwise: every booster has some.
// ponytail: redraws the whole pack, about 8 draws on average.
export function ultraPack(set: CardSet): Printing[] {
  let pack = drawPack(set);
  while (!hasUltra(pack)) pack = drawPack(set);
  return pack;
}

// Date of the next free booster, the number of earned boosters still waiting to be opened, and the opening that holds an Ultra for sure.
export async function boosterState(db: Db, userId: string): Promise<{ nextFreeAt: string; pending: number; ultraIn: number }> {
  const [row] = await db<{ nextFreeAt: Date; pending: number; sinceUltra: number; ultraPending: number }[]>`
    select next_free_at as "nextFreeAt", pending, since_ultra as "sinceUltra", ultra_pending as "ultraPending"
    from yugioh.booster_state where user_id = ${userId}`;
  if (!row) return { nextFreeAt: new Date().toISOString(), pending: 0, ultraIn: ULTRA_PITY + 1 };
  const ultraIn = row.ultraPending > 0 ? 1 : Math.max(1, ULTRA_PITY + 1 - row.sinceUltra);
  return { nextFreeAt: row.nextFreeAt.toISOString(), pending: row.pending, ultraIn };
}

// Boosters won in duels or Story mode, opened later in the set of the player's choice.
export async function creditBoosters(db: Sql, userId: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`nombre de boosters invalide : ${count}`);
  await db`
    insert into yugioh.booster_state (user_id, pending) values (${userId}, ${count})
    on conflict (user_id) do update set pending = booster_state.pending + excluded.pending`;
}

// A won booster whose opening holds an Ultra Rare for sure, whatever the pity counter says: the next opening owes it.
export async function creditUltraBooster(db: Sql, userId: string): Promise<void> {
  await db`
    insert into yugioh.booster_state (user_id, pending, ultra_pending) values (${userId}, 1, 1)
    on conflict (user_id) do update set pending = booster_state.pending + 1, ultra_pending = booster_state.ultra_pending + 1`;
}

// The free booster goes first, then the won ones. The row lock makes concurrent openings wait for each other.
export async function openBooster(db: Db, userId: string, setCode: string): Promise<Printing[]> {
  const set = BOOSTERS.get(setCode);
  if (!set) throw new Error(`booster inconnu : ${setCode}`);
  return db.begin(async (sql) => {
    await sql`insert into yugioh.booster_state (user_id) values (${userId}) on conflict do nothing`;
    const [state] = await sql<{ free: boolean; pending: number; sinceUltra: number; ultraPending: number }[]>`
      select next_free_at <= now() as free, pending, since_ultra as "sinceUltra", ultra_pending as "ultraPending"
      from yugioh.booster_state where user_id = ${userId} for update`;
    if (!state.free && state.pending === 0) throw new Error("aucun booster disponible");
    const source = state.free ? "free" : "earned";
    const owed = state.ultraPending > 0;
    const cards = owed || state.sinceUltra >= ULTRA_PITY ? ultraPack(set) : drawPack(set);
    await sql`
      update yugioh.booster_state set since_ultra = ${hasUltra(cards) ? 0 : state.sinceUltra + 1}, ultra_pending = ultra_pending - ${owed ? 1 : 0}
      where user_id = ${userId}`;
    const codes = cards.map((card) => card.code);
    await sql`
      insert into yugioh.booster_openings (user_id, set_code, source, cards) values (${userId}, ${set.code}, ${source}, ${codes})`;
    await addCards(sql, userId, cards);
    if (state.free) {
      await sql`
        update yugioh.booster_state set next_free_at = now() + make_interval(hours => ${FREE_BOOSTER_HOURS}) where user_id = ${userId}`;
    } else {
      await sql`update yugioh.booster_state set pending = pending - 1 where user_id = ${userId}`;
    }
    return cards;
  });
}
