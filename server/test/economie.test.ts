import { describe, expect, it } from "vitest";
import { income, quantile, simulateSet, weekly } from "../scripts/economie.ts";
import type { CardSet } from "../src/pool.ts";

// Un set d'une seule carte Ultra Rare, tirée à chaque booster.
const TOY: CardSet = { code: "TOY", name: "Jouet", date: "", slots: [{ rarity: [{ rarities: ["ultra"] }] }], cards: [{ code: 42, rarity: "ultra" }] };
const NO_CARD = () => ({ code: 0, rarity: "common" });

describe("simulation de l'économie", () => {
  it("donne 2 boosters par jour à un joueur connecté une fois par jour sans jouer : gratuit et récompense du jour", () => {
    const trace = income({ name: "test", minutes: 0, sessions: [20] }, 14);
    expect(trace.boosters).toEqual(Array(14).fill(2));
    const sources = weekly([trace], 0, 14);
    expect([sources.get("free"), sources.get("daily"), sources.get("story")]).toEqual([7, 7, 0]);
  });

  it("compte les jours pour tout posséder, avoir 3 exemplaires et tirer l'Ultra Rare du set d'une carte", () => {
    const trace = income({ name: "test", minutes: 0, sessions: [20] }, 14);
    // 2 boosters le jour 1 : 2 exemplaires ; 4 au jour 2 : 3 exemplaires.
    expect(simulateSet(TOY, trace, NO_CARD)).toEqual({ all: 1, three: 2, ultra: [1], secret: [] });
  });

  it("donne la médiane et le p90 par rang", () => {
    const values = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect([quantile(values, 0.5), quantile(values, 0.9)]).toEqual([5, 9]);
  });
});
