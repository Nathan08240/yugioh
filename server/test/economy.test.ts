import { describe, expect, it } from "vitest";
import { BOOSTERS, hasUltra, ultraPack } from "../src/boosters.ts";
import { conversionPlan, CRAFT_COSTS, parisDay } from "../src/economy.ts";
import { WHITELIST } from "../src/pool.ts";

describe("économie", () => {
  it("convertit les exemplaires au-delà de 3, rareté inconnue puis la plus faible d'abord", () => {
    const plan = conversionPlan(
      [[1, 3], [2, 8], [3, 5]],
      [[1, "ultra", 3], [2, "secret", 1], [2, "rare", 2], [2, "common", 1], [3, "super", 5]],
    );
    // Carte 2 : 4 inconnues, 1 commune, 2 rares, 1 secrète ; 5 à convertir.
    expect(plan.cards).toEqual([[2, "", 4], [2, "common", 1], [3, "super", 2]]);
    expect(plan.points).toBe(4 * 5 + 5 + 2 * 50);
    expect(conversionPlan([[2, 6]], [[2, "secret", 1], [2, "rare", 2], [2, "shortprint", 3]])).toEqual({
      cards: [[2, "shortprint", 3]],
      points: 15,
    });
  });

  it("donne un coût à chaque carte des boosters selon sa meilleure rareté, aucune aux cartes hors boosters", () => {
    expect(CRAFT_COSTS.size).toBe(new Set([...BOOSTERS.values()].flatMap((set) => set.cards.map((card) => card.code))).size);
    // Blue-Eyes White Dragon : Ultra dans LOB.
    expect(CRAFT_COSTS.get(89631139)).toBe(500);
    expect(new Set(CRAFT_COSTS.values())).toEqual(new Set([40, 100, 250, 500, 1000]));
    for (const code of WHITELIST) expect(CRAFT_COSTS.has(code)).toBe(false);
  });

  it("tire une Ultra Rare ou mieux dans chaque booster quand elle est garantie", () => {
    for (const set of BOOSTERS.values()) {
      for (let i = 0; i < 20; i++) expect(hasUltra(ultraPack(set))).toBe(true);
    }
  });

  it("change de jour à minuit heure de Paris", () => {
    expect(parisDay(new Date("2026-09-30T21:59:00Z"))).toBe("2026-09-30");
    expect(parisDay(new Date("2026-09-30T22:00:00Z"))).toBe("2026-10-01");
  });
});
