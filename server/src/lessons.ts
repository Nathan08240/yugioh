import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgType } from "@n1xx1/ocgcore-wasm";
import { readCard } from "./cards.ts";
import type { Db } from "./db.ts";
import { EXTRA_MAX } from "./deckcheck.ts";
import { grant } from "./missions.ts";
import { isAllowed } from "./pool.ts";
import { LESSON_POINTS, type LessonView } from "./protocol.ts";
import { validatePuzzles, type Puzzle } from "./puzzles.ts";
import { unlock } from "./story.ts";

// Format of data/lessons.json: a puzzle (a position set up by hand, won in the player's first turn) plus the Extra Deck of the
// player. The bubbles that guide each lesson are in client/src/lecons.ts, by id.
export type Lesson = Puzzle & { extra?: number[] };

export function validateLessons(lessons: Lesson[]): string[] {
  const errors = validatePuzzles(lessons);
  for (const { id, extra = [] } of lessons) {
    if (extra.length > EXTRA_MAX) errors.push(`${id} : extra deck de plus de ${EXTRA_MAX} cartes`);
    for (const code of extra) {
      if (!((readCard(code)?.type ?? 0) & OcgType.FUSION) || !isAllowed(code)) errors.push(`${id} : ${code} n'est pas une fusion du pool`);
    }
  }
  return errors;
}

export const LESSONS: Lesson[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "lessons.json"), "utf-8"));
const errors = validateLessons(LESSONS);
if (errors.length > 0) throw new Error(`data/lessons.json invalide :\n${errors.join("\n")}`);

export const LESSON_IDS: ReadonlyMap<string, Lesson> = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

export const lessonView = (done: ReadonlySet<string>): LessonView[] => LESSONS.map(({ id, title, goal }) => ({ id, title, goal, done: done.has(id) }));

const UNLOCK = "lecon:";

// Ids of the lessons won, kept with the story unlocks.
export async function solvedLessons(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db<{ id: string }[]>`
    select unlock_id as id from yugioh.story_unlocks where user_id = ${userId} and starts_with(unlock_id, ${UNLOCK})`;
  return new Set(rows.map((row) => row.id.slice(UNLOCK.length)));
}

// Records a won lesson: true the first time, which earns LESSON_POINTS collection points.
export async function solveLesson(db: Db, userId: string, id: string): Promise<boolean> {
  return db.begin(async (sql) => {
    const first = await unlock(sql, userId, `${UNLOCK}${id}`);
    if (first) await grant(sql, userId, { points: LESSON_POINTS });
    return first;
  });
}
