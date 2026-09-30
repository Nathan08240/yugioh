import { describe, expect, it } from "vitest";
import { BOOSTERS } from "../src/boosters.ts";
import { drawWonder, validWonderMessage, WONDER_CARDS } from "../src/wonder.ts";

describe("tirage de la pioche miracle", () => {
  it("tire 5 cartes distinctes d'un booster, avec leur rareté, et un ordre face cachée qui les reprend toutes", () => {
    const sets = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const { set, cards, shuffle } = drawWonder();
      sets.add(set);
      expect(cards).toHaveLength(WONDER_CARDS);
      expect(new Set(cards).size).toBe(WONDER_CARDS);
      expect(cards.every((card) => BOOSTERS.get(set)?.cards.includes(card))).toBe(true);
      expect(shuffle.toSorted()).toEqual([0, 1, 2, 3, 4]);
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  it("n'accepte que les index de 0 à 4", () => {
    expect([0, 4].every((index) => validWonderMessage({ type: "wonder_pick", index }))).toBe(true);
    expect([-1, 5, 1.5, "1", undefined].some((index) => validWonderMessage({ type: "wonder_pick", index }))).toBe(false);
    expect(validWonderMessage({ type: "wonder" })).toBe(true);
  });
});
