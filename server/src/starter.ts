import { addCards } from "./collection.ts";
import type { Db } from "./db.ts";
import { type Printing, SETS } from "./pool.ts";

export type Starter = "yugi" | "kaiba";
const SET_CODE: Record<Starter, string> = { yugi: "SDY", kaiba: "SDK" };
const DECK_NAME: Record<Starter, string> = { yugi: "Starter Yugi", kaiba: "Starter Kaiba" };

function starterPrintings(starter: Starter): Printing[] {
  const set = SETS.find((candidate) => candidate.code === SET_CODE[starter]);
  if (!set) throw new Error(`starter introuvable : ${starter}`);
  return set.cards;
}

export const starterCards = (starter: Starter): number[] => starterPrintings(starter).map((card) => card.code);

// Adds the starter's cards to the collection, creates its deck and makes it active.
// Refused (false) once a deck is already active, including two concurrent calls: the row lock serializes them.
export async function chooseStarter(db: Db, userId: string, starter: Starter): Promise<boolean> {
  const printings = starterPrintings(starter);
  const codes = printings.map((card) => card.code);
  return db.begin(async (sql) => {
    const [profile] = await sql<{ activeDeckId: number | null }[]>`
      select active_deck_id as "activeDeckId" from yugioh.profiles where user_id = ${userId} for update`;
    if (!profile || profile.activeDeckId !== null) return false;
    await addCards(sql, userId, printings);
    const [deck] = await sql<{ id: number }[]>`
      insert into yugioh.decks (user_id, name, main_deck) values (${userId}, ${DECK_NAME[starter]}, ${codes})
      returning id`;
    await sql`update yugioh.profiles set active_deck_id = ${deck.id} where user_id = ${userId}`;
    return true;
  });
}
