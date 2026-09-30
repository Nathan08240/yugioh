import type { Db } from "./db.ts";
import type { DeckResult, DuelMode } from "./protocol.ts";

export type DuelResult = { userId: string; deckId?: number; mode: DuelMode; level?: string; won: boolean; reason: number; turns: number };

// A deck deleted since the start of the duel leaves a null deck_id.
export async function recordResult(db: Db, result: DuelResult): Promise<void> {
  const { userId, deckId = null, mode, level = null, won, reason, turns } = result;
  await db`
    insert into yugioh.duel_results (user_id, deck_id, mode, level, won, reason, turns)
    values (${userId}, (select id from yugioh.decks where id = ${deckId} and user_id = ${userId}), ${mode}, ${level}, ${won}, ${reason}, ${turns})`;
}

// Wins and losses of the player per deck and mode; `deck` is null for a deck deleted since. Sum the rows for any total.
export async function readResults(db: Db, userId: string): Promise<DeckResult[]> {
  const rows = await db<{ deck: string | null; mode: DuelMode; wins: number; losses: number }[]>`
    select deck_id as deck, mode, (count(*) filter (where won))::int as wins, (count(*) filter (where not won))::int as losses
    from yugioh.duel_results where user_id = ${userId} group by deck_id, mode order by deck_id, mode`;
  return rows.map((row) => ({ ...row, deck: row.deck === null ? null : Number(row.deck) }));
}
