import { describe, expect, it } from "vitest";
import type { Message } from "../../client/src/board.ts";
import { avancer, ETAPES } from "../../client/src/tutoriel.ts";
import { Bot } from "../src/bot.ts";
import { lpOf, runDuel, type Player } from "../src/duel.ts";
import type { DuelEvent } from "../src/protocol.ts";
import { TUTORIAL, TUTORIAL_FIELD, TUTORIAL_RULES, validateTutorial } from "../src/tutorial.ts";
import { pass, pupil } from "./solver.ts";

// Against the Normal bot, as on the server; `seen` keeps the messages seat 0 saw.
async function play(player: Player) {
  const bot = new Bot(1, lpOf(TUTORIAL_RULES, 1), [0, 0], 0);
  let seen: readonly DuelEvent[] = [];
  const watched: Player = (question, log) => {
    seen = log;
    return player(question, log);
  };
  const state = await runDuel([1n, 2n, 3n, 4n], 10, [watched, (question, log) => bot.answer(question, log)], [[], []], TUTORIAL_RULES, [], TUTORIAL_FIELD);
  return { state, seen: seen as unknown as Message[] };
}

describe("tutoriel", () => {
  it("valide ses données : cartes du pool, rangées de 5 au plus", () => {
    expect(validateTutorial(TUTORIAL)).toEqual([]);
    expect(validateTutorial({ ...TUTORIAL, opponent: { lp: 3000, hand: [1] } })).toEqual(["adversaire : carte 1 absente de BabelCDB"]);
  });

  it("suivre les consignes passe chaque étape dans l'ordre et gagne au troisième tour", { timeout: 30_000 }, async () => {
    const { state, seen } = await play(pupil);
    expect(state.errors).toEqual([]);
    const passed: number[] = [];
    let step = 0;
    for (const msg of seen) {
      const next = avancer(step, [msg], 0);
      if (next !== step) passed.push(next);
      step = next;
    }
    expect(passed).toEqual(ETAPES.map((_step, index) => index + 1));
    expect(state.log).toContain("J1 active Mirror Force");
    expect(state.winner).toBe(0);
    expect(state.turns).toBe(3);
  });

  it("reste un vrai duel : finir chaque tour sans jouer ne gagne pas", { timeout: 30_000 }, async () => {
    const { state, seen } = await play(pass);
    expect(state.winner).not.toBe(0);
    expect(avancer(0, seen, 0)).toBe(4);
  });
});
