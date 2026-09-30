import { readFileSync } from "node:fs";
import { join } from "node:path";
import { creditBoosters } from "./boosters.ts";
import type { Db } from "./db.ts";
import type { Rules } from "./duel.ts";
import { checkSide, puzzleField, puzzleRules, type PuzzleSide } from "./puzzles.ts";
import { unlock } from "./story.ts";

// Format of data/tutorial.json: the guided duel of client/src/tutoriel.ts, hands and decks in a fixed order (top card first).
export type Tutorial = { player: PuzzleSide; opponent: PuzzleSide };

// Boosters of the first win of the tutorial.
export const TUTORIAL_BOOSTERS = 1;
const UNLOCK = "tutorial";

export const validateTutorial = (tutorial: Tutorial): string[] => [...checkSide(tutorial.player, "joueur"), ...checkSide(tutorial.opponent, "adversaire")];

export const TUTORIAL: Tutorial = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "tutorial.json"), "utf-8"));
const errors = validateTutorial(TUTORIAL);
if (errors.length > 0) throw new Error(`data/tutorial.json invalide :\n${errors.join("\n")}`);

// Set up as a puzzle, but a real duel: a card drawn each turn, no turn limit.
export const TUTORIAL_RULES: Rules = { ...puzzleRules(TUTORIAL), draw: 1 };
export const TUTORIAL_FIELD = puzzleField(TUTORIAL);

// Records a win of the tutorial: true the first time, which earns TUTORIAL_BOOSTERS.
export async function finishTutorial(db: Db, userId: string): Promise<boolean> {
  return db.begin(async (sql) => {
    const first = await unlock(sql, userId, UNLOCK);
    if (first) await creditBoosters(sql, userId, TUTORIAL_BOOSTERS);
    return first;
  });
}
