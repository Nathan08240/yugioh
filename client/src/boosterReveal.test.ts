import { expect, it } from "vitest";
import { isDone, startReveal, stepReveal } from "./boosterReveal.ts";

it("révèle les cartes une à une jusqu'au total, puis s'arrête", () => {
  let state = startReveal(3);
  expect(isDone(state)).toBe(false);

  state = stepReveal(state);
  expect(state).toEqual({ revealed: 1, total: 3 });

  state = stepReveal(stepReveal(state));
  expect(state).toEqual({ revealed: 3, total: 3 });
  expect(isDone(state)).toBe(true);

  // Capped: one more step changes nothing.
  expect(stepReveal(state)).toEqual(state);
});
