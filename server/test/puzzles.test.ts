import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { lpOf, runDuel, type Player } from "../src/duel.ts";
import { PUZZLE_DIFFICULTIES } from "../src/protocol.ts";
import { PUZZLE_TURNS, PUZZLES, puzzleField, puzzleRules, validatePuzzles, type Puzzle } from "../src/puzzles.ts";
import { ACTIONS, pass, rush, solver } from "./solver.ts";

// Against the Normal bot, as on the server.
function solve(puzzle: Puzzle, player: Player) {
  const rules = puzzleRules(puzzle);
  const bot = new Bot(1, lpOf(rules, 1), [0, 0], 0);
  return runDuel([1n, 2n, 3n, 4n], PUZZLE_TURNS, [player, (question, log) => bot.answer(question, log)], [[], []], rules, [], puzzleField(puzzle));
}

describe("puzzles", () => {
  it("valident leurs données : 28 puzzles de trois niveaux, cartes du pool, solutions aux actions connues", () => {
    expect(validatePuzzles(PUZZLES)).toEqual([]);
    expect(PUZZLES).toHaveLength(28);
    expect(PUZZLE_DIFFICULTIES.map((level) => PUZZLES.filter((puzzle) => puzzle.difficulty === level).length)).toEqual([10, 10, 8]);
    for (const puzzle of PUZZLES) for (const [action] of puzzle.solution) expect(ACTIONS).toContain(action);
  });

  it("signalent une carte hors pool, une position inconnue et un identifiant en double", () => {
    const [first] = PUZZLES;
    const broken: Puzzle = { ...first, player: { lp: 0, hand: [1], monsters: [[46986414, "couchée" as "set"]] } };
    expect(validatePuzzles([broken, first])).toEqual([
      "identifiant de puzzle en double",
      "coup-de-grace : joueur : LP invalides",
      "coup-de-grace : joueur : position inconnue couchée",
      "coup-de-grace : joueur : carte 1 absente de BabelCDB",
    ]);
  });

  it.each(PUZZLES.map((puzzle) => [puzzle.id, puzzle] as const))("%s : la solution gagne avant la fin du tour", async (_id, puzzle) => {
    const state = await solve(puzzle, solver(puzzle.solution));
    expect(state.errors).toEqual([]);
    expect(state.winner).toBe(0);
    expect(state.turns).toBe(1);
  });

  it("le bot répond avec sa carte posée : attaquer sans la détruire déclenche Mirror Force", async () => {
    const state = await solve(PUZZLES.find((puzzle) => puzzle.id === "miroir") as Puzzle, solver([["battle"], ["attack", 11091375]]));
    expect(state.log).toContain("J2 active Mirror Force");
    expect(state.winner).toBeNull();
  });

  it.each(PUZZLES.map((puzzle) => [puzzle.id, puzzle] as const))("%s : finir son tour sans jouer ne gagne pas", async (_id, puzzle) => {
    const state = await solve(puzzle, pass);
    expect(state.winner).toBeNull();
    expect(state.lp[1]).toBe(puzzle.opponent.lp);
  });

  // A puzzle won by the order of the attacks alone (no card played) is meant to be won by attacking.
  const COMBAT = new Set(["battle", "attack", "select"]);
  const playsCards = (puzzle: Puzzle) => puzzle.solution.some(([action]) => !COMBAT.has(action));
  it.each(PUZZLES.filter(playsCards).map((puzzle) => [puzzle.id, puzzle] as const))("%s : attaquer sans rien jouer ne gagne pas", async (_id, puzzle) => {
    expect((await solve(puzzle, rush)).winner).not.toBe(0);
  });
});
