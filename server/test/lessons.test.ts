import { OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import type { Message } from "../../client/src/board.ts";
import { parcoursDeLecon } from "../../client/src/lecons.ts";
import { avancer } from "../../client/src/tutoriel.ts";
import { Bot } from "../src/bot.ts";
import { lpOf, runDuel, type Player } from "../src/duel.ts";
import { LESSONS, validateLessons, type Lesson } from "../src/lessons.ts";
import { LESSON_POINTS } from "../src/protocol.ts";
import { PUZZLE_TURNS, puzzleField, puzzleRules } from "../src/puzzles.ts";
import { LESSON_ACTIONS, lessonSolver } from "./lecons-solver.ts";
import { ACTIONS, pass } from "./solver.ts";

// Against the Normal bot, as on the server; `log` is what the player saw, kept up to the end of the duel.
async function play(lesson: Lesson, player: Player) {
  const rules = puzzleRules(lesson);
  const bot = new Bot(1, lpOf(rules, 1), [0, 0], 0);
  let log: readonly OcgMessage[] = [];
  const recording: Player = (question, seen) => {
    log = seen;
    return player(question, seen);
  };
  const state = await runDuel([1n, 2n, 3n, 4n], PUZZLE_TURNS, [recording, (question, seen) => bot.answer(question, seen)], [[], []], rules, [lesson.extra ?? [], []], puzzleField(lesson));
  return { state, log };
}

const byId = (id: string) => LESSONS.find((lesson) => lesson.id === id) as Lesson;

describe("leçons", () => {
  it("valident leurs données : 6 leçons, cartes du pool, solutions aux actions connues, bulles pour chacune", () => {
    expect(validateLessons(LESSONS)).toEqual([]);
    expect(LESSONS).toHaveLength(6);
    for (const lesson of LESSONS) {
      for (const [action] of lesson.solution) expect(new Set([...ACTIONS, ...LESSON_ACTIONS])).toContain(action);
      expect(parcoursDeLecon(lesson.id)?.etapes.length).toBeGreaterThan(1);
    }
  });

  it("toutes les leçons ensemble rapportent moins qu'un booster : sous les 360 points d'un booster de 9 cartes craftées", () => {
    expect(LESSONS.length * LESSON_POINTS).toBeLessThan(9 * 40);
  });

  it("signalent une carte hors pool, une Extra Deck sans Fusion et un identifiant en double", () => {
    const fusion = byId("fusion");
    const broken: Lesson = { ...fusion, extra: [28279543, 1] };
    expect(validateLessons([broken, fusion])).toEqual([
      "identifiant de puzzle en double",
      "fusion : 28279543 n'est pas une fusion du pool",
      "fusion : 1 n'est pas une fusion du pool",
    ]);
  });

  it.each(LESSONS.map((lesson) => [lesson.id, lesson] as const))("%s : la bonne suite d'actions gagne avant la fin du tour, chaque bulle s'allume dans l'ordre", async (_id, lesson) => {
    const { state, log } = await play(lesson, lessonSolver(lesson.solution));
    expect(state.errors).toEqual([]);
    expect(state.winner).toBe(0);
    expect(state.turns).toBe(1);
    // The bubbles follow the real messages of the engine: the last one waits for the win, none is skipped.
    const { etapes } = parcoursDeLecon(lesson.id) ?? { etapes: [] };
    const seen = log as unknown as Message[];
    expect(avancer(0, seen.filter((msg) => msg.type !== OcgMessageType.WIN), 0, etapes)).toBe(etapes.length - 1);
    expect(avancer(0, seen, 0, etapes)).toBe(etapes.length);
  });

  it.each(LESSONS.map((lesson) => [lesson.id, lesson] as const))("%s : finir son tour sans jouer ne gagne pas", async (_id, lesson) => {
    const { state } = await play(lesson, pass);
    expect(state.winner).toBeNull();
    expect(state.lp[1]).toBe(lesson.opponent.lp);
  });

  it("le mauvais sacrifice ne suffit pas à gagner", async () => {
    const { state } = await play(byId("tribut-simple"), lessonSolver([["summon", 28279543], ["select", 47060154], ["battle"], ["attack", 28279543], ["attack", 39552864]]));
    expect(state.winner).toBeNull();
  });
});
