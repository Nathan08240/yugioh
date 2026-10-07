import { creditBoosters, WIN_BOOSTER_REWARD } from "./boosters.ts";
import type { Db } from "./db.ts";
import { parisDay } from "./economy.ts";
import { ONLINE_BOOSTERS_MAX } from "./protocol.ts";
import { unlock } from "./story.ts";

// Booster of an online or ranked win, ONLINE_BOOSTERS_MAX a day (Europe/Paris). Each slot of the day is a story_unlocks row,
// so two wins ending together cannot take the same one. Resolves to false once the day is full.
export async function winOnline(db: Db, userId: string): Promise<boolean> {
  const day = parisDay();
  for (let slot = 1; slot <= ONLINE_BOOSTERS_MAX; slot++) {
    const taken = await db.begin(async (sql) => {
      if (!(await unlock(sql, userId, `online:${day}:${slot}`))) return false;
      await creditBoosters(sql, userId, WIN_BOOSTER_REWARD);
      return true;
    });
    if (taken) return true;
  }
  return false;
}

// Boosters earned by online wins today.
export async function onlineToday(db: Db, userId: string): Promise<number> {
  const [{ count }] = await db<{ count: number }[]>`
    select count(*)::int as count from yugioh.story_unlocks where user_id = ${userId} and starts_with(unlock_id, ${`online:${parisDay()}:`})`;
  return count;
}
