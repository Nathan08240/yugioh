import { expect, it } from "vitest";
import { elo, K_FACTOR, pairUp, RANGE_EVERY, REMATCH_DELAY, type Waiting } from "../src/ranked.ts";

const player = (id: string, rating: number, since = 0): Waiting => ({ id, rating, since });
const ids = (pairs: [Waiting, Waiting][]) => pairs.map((pair) => pair.map((one) => one.id));
const none = new Map();

it("calcule l'Elo avec K = 32 : ±16 à égalité, moins pour le favori, un nul rapproche les classements", () => {
  expect(K_FACTOR).toBe(32);
  expect(elo([1000, 1000], 0)).toEqual([1016, 984]);
  expect(elo([1000, 1000], 1)).toEqual([984, 1016]);
  expect(elo([1400, 1000], 0)).toEqual([1403, 997]);
  expect(elo([1400, 1000], 1)).toEqual([1371, 1029]);
  expect(elo([1000, 1000], null)).toEqual([1000, 1000]);
  expect(elo([1200, 1000], null)).toEqual([1192, 1008]);
});

it("apparie deux joueurs à 100 points d'écart au plus, le plus proche d'abord", () => {
  expect(ids(pairUp([player("a", 1000), player("b", 1100)], 0, none))).toEqual([["a", "b"]]);
  expect(pairUp([player("a", 1000), player("b", 1101)], 0, none)).toEqual([]);
  expect(ids(pairUp([player("a", 1000, 0), player("b", 1090, 1), player("c", 1010, 2), player("d", 1080, 3)], 5, none))).toEqual([
    ["a", "c"],
    ["b", "d"],
  ]);
  expect(pairUp([player("seul", 1000)], 0, none)).toEqual([]);
});

it("élargit l'écart de 50 points toutes les 10 s d'attente du joueur qui attend depuis le plus longtemps", () => {
  const waiting = [player("a", 1000, 0), player("b", 1150, 5000)];
  expect(pairUp(waiting, RANGE_EVERY - 1, none)).toEqual([]);
  expect(ids(pairUp(waiting, RANGE_EVERY, none))).toEqual([["a", "b"]]);
  expect(pairUp([player("a", 1000, 0), player("b", 1201, 0)], 2 * RANGE_EVERY, none)).toEqual([]);
  expect(ids(pairUp([player("a", 1000, 0), player("b", 1200, 0)], 2 * RANGE_EVERY, none))).toEqual([["a", "b"]]);
});

it("n'apparie pas deux fois de suite les mêmes joueurs en moins de 10 minutes", () => {
  const waiting = [player("a", 1000), player("b", 1000)];
  const last = new Map([["a", { opponent: "b", at: 0 }], ["b", { opponent: "a", at: 0 }]]);
  expect(pairUp(waiting, REMATCH_DELAY - 1, last)).toEqual([]);
  expect(pairUp(waiting, 5, new Map([["b", { opponent: "a", at: 0 }]]))).toEqual([]);
  expect(ids(pairUp(waiting, REMATCH_DELAY, last))).toEqual([["a", "b"]]);
  // Another opponent is fine at once.
  expect(ids(pairUp([...waiting, player("c", 1050)], 5, last))).toEqual([["a", "c"]]);
});
