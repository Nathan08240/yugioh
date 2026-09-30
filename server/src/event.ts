import { creditBoosters } from "./boosters.ts";
import type { Db } from "./db.ts";
import type { Rules } from "./duel.ts";
import { EXTRA_RULES, unlock } from "./story.ts";

// Story rules that play outside their arc, with the starting LP and hand of that arc, in rotation one per week.
// virtual-world is left out: each player must pick a Deck Master, which the room screen cannot ask.
export const EVENTS = [
  { rule: "duelist-kingdom", lp: 2000, hand: 5 },
  { rule: "battle-city", lp: 4000, hand: 5 },
] as const;

// `id`: ISO week of the year, "2026-W40".
export type WeeklyEvent = (typeof EVENTS)[number] & { id: string };

const DAY = 86_400_000;
// en-CA writes the date as YYYY-MM-DD.
const PARIS_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });

// The event of the week (Monday to Sunday, Europe/Paris) of `date`.
export function eventOf(date = new Date()): WeeklyEvent {
  const days = Math.floor(Date.parse(PARIS_DATE.format(date)) / DAY);
  // 1970-01-01 was a Thursday: the week number counts from a Monday, the ISO week belongs to the year of its Thursday.
  const thursday = days - ((days + 3) % 7) + 3;
  const year = new Date(thursday * DAY).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1) / DAY) / 7) + 1;
  return { ...EVENTS[Math.floor((days + 3) / 7) % EVENTS.length], id: `${year}-W${String(week).padStart(2, "0")}` };
}

export const eventRules = ({ rule, lp, hand }: WeeklyEvent): Rules => ({ lp, hand, cards: [EXTRA_RULES.get(rule) as number] });

const unlockId = (id: string) => `event:${id}`;

export async function eventWon(db: Db, userId: string, id: string): Promise<boolean> {
  const [row] = await db`select 1 from yugioh.story_unlocks where user_id = ${userId} and unlock_id = ${unlockId(id)}`;
  return row !== undefined;
}

// 1 booster for the first event win of the week: resolves to false when this week's one was already taken.
export const claimEvent = (db: Db, userId: string, id: string): Promise<boolean> =>
  db.begin(async (sql) => {
    if (!(await unlock(sql, userId, unlockId(id)))) return false;
    await creditBoosters(sql, userId, 1);
    return true;
  });
