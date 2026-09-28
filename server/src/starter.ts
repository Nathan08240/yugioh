import type { Db } from "./db.ts";
import { SETS } from "./pool.ts";

export type Starter = "yugi" | "kaiba";
const SET_CODE: Record<Starter, string> = { yugi: "SDY", kaiba: "SDK" };
const DECK_NAME: Record<Starter, string> = { yugi: "Starter Yugi", kaiba: "Starter Kaiba" };

export function starterCards(starter: Starter): number[] {
  const set = SETS.find((candidate) => candidate.code === SET_CODE[starter]);
  if (!set) throw new Error(`starter introuvable : ${starter}`);
  return set.cards.map((card) => card.code);
}

// Adds the starter's cards to the collection, creates its deck and makes it active.
// Refused (false) once a deck is already active, including two concurrent calls: the row lock serializes them.
export async function chooseStarter(db: Db, userId: string, starter: Starter): Promise<boolean> {
  const codes = starterCards(starter);
  return db.begin(async (sql) => {
    const [profile] = await sql<{ activeDeckId: number | null }[]>`
      select active_deck_id as "activeDeckId" from yugioh.profiles where user_id = ${userId} for update`;
    if (!profile || profile.activeDeckId !== null) return false;
    await sql`
      insert into yugioh.collection (user_id, card_code, quantity)
      select ${userId}::uuid, code, count(*) from unnest(${codes}::integer[]) code group by code
      on conflict (user_id, card_code) do update set quantity = collection.quantity + excluded.quantity`;
    const [deck] = await sql<{ id: number }[]>`
      insert into yugioh.decks (user_id, name, main_deck) values (${userId}, ${DECK_NAME[starter]}, ${codes})
      returning id`;
    await sql`update yugioh.profiles set active_deck_id = ${deck.id} where user_id = ${userId}`;
    return true;
  });
}
