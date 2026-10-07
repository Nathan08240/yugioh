import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgLocation, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import { creditBoosters } from "./boosters.ts";
import { readCard } from "./cards.ts";
import type { Db } from "./db.ts";
import type { Placed, Rules } from "./duel.ts";
import { isAllowed } from "./pool.ts";
import { PUZZLE_DIFFICULTIES, type PuzzleDifficulty, type PuzzleView } from "./protocol.ts";
import { unlock } from "./story.ts";

type MonsterPosition = "attack" | "defense" | "set";
// One side of a puzzle. Monsters and set Spells or Traps fill their zones from 0, in order; `deck` lists its top card first, `extra` is its Extra Deck.
export type PuzzleSide = {
  lp: number;
  hand?: number[];
  monsters?: [code: number, position: MonsterPosition][];
  spells?: number[];
  grave?: number[];
  deck?: number[];
  extra?: number[];
};
// A step of the solution: an action of the player and the passcodes it picks (0 for a card they cannot see), replayed by the tests.
export type Step = [action: string, ...codes: number[]];
// Format of data/puzzles.json: situations written by us, cards of the pool only, won in the player's first turn.
export type Puzzle = { id: string; difficulty: PuzzleDifficulty; title: string; goal: string; player: PuzzleSide; opponent: PuzzleSide; solution: Step[] };
// Both sides of a duel state set up by hand (a puzzle, the tutorial).
type Sides = Pick<Puzzle, "player" | "opponent">;

// Boosters of the first win of each puzzle.
export const PUZZLE_BOOSTERS = 1;
// The player has one turn: the start of the next one fails the puzzle.
export const PUZZLE_TURNS = 1;
const MAX_TEXT = 300;
const ZONES = 5;
const POSITIONS = new Map<string, OcgPosition>([
  ["attack", OcgPosition.FACEUP_ATTACK],
  ["defense", OcgPosition.FACEUP_DEFENSE],
  ["set", OcgPosition.FACEDOWN_DEFENSE],
]);

function checkCard(code: number, where: string): string[] {
  const card = readCard(code);
  if (!card) return [`carte ${code} absente de BabelCDB`];
  if (!isAllowed(code)) return [`carte ${code} hors pool`];
  if (where === "monstres" && (card.type & OcgType.MONSTER) === 0) return [`${code} n'est pas un monstre`];
  if (where === "magies" && (card.type & OcgType.MONSTER) !== 0) return [`${code} est un monstre, pas une Magie ou un Piège`];
  return [];
}

export function checkSide(side: PuzzleSide, name: string): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(side.lp) || side.lp <= 0) errors.push(`${name} : LP invalides`);
  const monsters = side.monsters ?? [];
  const spells = side.spells ?? [];
  if (monsters.length > ZONES || spells.length > ZONES) errors.push(`${name} : plus de ${ZONES} cartes dans une rangée`);
  for (const [, position] of monsters) if (!POSITIONS.has(position)) errors.push(`${name} : position inconnue ${position}`);
  const cards: [number, string][] = [
    ...(side.hand ?? []).map((code) => [code, "main"] as [number, string]),
    ...[...monsters.map(([code]) => code), ...(side.extra ?? [])].map((code) => [code, "monstres"] as [number, string]),
    ...spells.map((code) => [code, "magies"] as [number, string]),
    ...[...(side.grave ?? []), ...(side.deck ?? [])].map((code) => [code, "pile"] as [number, string]),
  ];
  for (const [code, where] of cards) errors.push(...checkCard(code, where).map((problem) => `${name} : ${problem}`));
  return errors;
}

// Every problem of the data, prefixed by the puzzle id. Empty when the puzzles can be played.
export function validatePuzzles(puzzles: Puzzle[]): string[] {
  const errors: string[] = [];
  if (new Set(puzzles.map((puzzle) => puzzle.id)).size !== puzzles.length) errors.push("identifiant de puzzle en double");
  for (const puzzle of puzzles) {
    const problems = [...checkSide(puzzle.player, "joueur"), ...checkSide(puzzle.opponent, "adversaire")];
    for (const text of [puzzle.title, puzzle.goal]) if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) problems.push(`texte vide ou de plus de ${MAX_TEXT} caractères`);
    if (!PUZZLE_DIFFICULTIES.includes(puzzle.difficulty)) problems.push(`difficulté inconnue ${puzzle.difficulty}`);
    if (puzzle.solution.length === 0) problems.push("solution absente");
    errors.push(...problems.map((problem) => `${puzzle.id} : ${problem}`));
  }
  return errors;
}

export const PUZZLES: Puzzle[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "puzzles.json"), "utf-8"));
const errors = validatePuzzles(PUZZLES);
if (errors.length > 0) throw new Error(`data/puzzles.json invalide :\n${errors.join("\n")}`);

export const PUZZLE_IDS: ReadonlyMap<string, Puzzle> = new Map(PUZZLES.map((puzzle) => [puzzle.id, puzzle]));

// Empty decks and no draw: the duel opens on the Main Phase 1 of the player, who may attack.
export const puzzleRules = (puzzle: Sides): Rules => ({ lp: puzzle.opponent.lp, playerLp: puzzle.player.lp, hand: 0, cards: [], draw: 0, firstTurnAttack: true });

function sideField(side: PuzzleSide, controller: 0 | 1): Placed[] {
  const at = (location: OcgLocation, position: OcgPosition) => (code: number, sequence: number): Placed => ({ code, controller, location, sequence, position });
  return [
    ...(side.hand ?? []).map(at(OcgLocation.HAND, OcgPosition.FACEDOWN_DEFENSE)),
    ...(side.monsters ?? []).map(([code, position], sequence) => at(OcgLocation.MZONE, POSITIONS.get(position) as OcgPosition)(code, sequence)),
    ...(side.spells ?? []).map(at(OcgLocation.SZONE, OcgPosition.FACEDOWN)),
    ...(side.grave ?? []).map(at(OcgLocation.GRAVE, OcgPosition.FACEUP_ATTACK)),
    // Each card goes on top of the deck: the last one placed is the first listed.
    ...(side.deck ?? []).toReversed().map((code) => at(OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE)(code, 0)),
    ...(side.extra ?? []).map((code) => at(OcgLocation.EXTRA, OcgPosition.FACEDOWN_DEFENSE)(code, 0)),
  ];
}

export const puzzleField = (puzzle: Sides): Placed[] => [...sideField(puzzle.player, 0), ...sideField(puzzle.opponent, 1)];

export const puzzleView = (done: ReadonlySet<string>): PuzzleView[] => PUZZLES.map(({ id, title, goal, difficulty }) => ({ id, title, goal, difficulty, done: done.has(id) }));

const UNLOCK = "puzzle:";

// Ids of the puzzles solved, kept with the story unlocks.
export async function solvedPuzzles(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db<{ id: string }[]>`
    select unlock_id as id from yugioh.story_unlocks where user_id = ${userId} and starts_with(unlock_id, ${UNLOCK})`;
  return new Set(rows.map((row) => row.id.slice(UNLOCK.length)));
}

// Records a solved puzzle: true the first time, which earns PUZZLE_BOOSTERS.
export async function solvePuzzle(db: Db, userId: string, id: string): Promise<boolean> {
  return db.begin(async (sql) => {
    const first = await unlock(sql, userId, `${UNLOCK}${id}`);
    if (first) await creditBoosters(sql, userId, PUZZLE_BOOSTERS);
    return first;
  });
}
