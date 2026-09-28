import { describe, expect, it } from "vitest";
import { BOOSTERS, drawPack } from "../src/boosters.ts";
import type { CardSet } from "../src/pool.ts";

const booster = (code: string) => BOOSTERS.get(code) as CardSet;

// Share of packs whose slot `index` has one of `rarities`, within 5 standard deviations of `odds`.
function expectOdds(packs: { rarity: string }[][], index: number, rarities: string[], odds: number) {
  const share = packs.filter((pack) => rarities.includes(pack[index].rarity)).length / packs.length;
  expect(Math.abs(share - odds)).toBeLessThan(5 * Math.sqrt((odds * (1 - odds)) / packs.length));
}

describe("tirage des boosters", () => {
  it("couvre les 14 boosters, pas les starter decks", () => {
    expect([...BOOSTERS.keys()]).toEqual(["LOB", "MRD", "MRL", "PSV", "LON", "LOD", "PGD", "MFC", "DCR", "IOC", "AST", "SOD", "RDS", "FET"]);
  });

  it("tire 9 cartes du set, sans doublon de même rareté : 7 communes, 1 rare, 1 brillante ou commune", () => {
    for (const set of BOOSTERS.values()) {
      for (let i = 0; i < 200; i++) {
        const pack = drawPack(set);
        expect(pack).toHaveLength(9);
        expect(pack.every((card) => set.cards.includes(card))).toBe(true);
        expect(pack.slice(0, 7).every((card) => card.rarity === "common" || card.rarity === "shortprint")).toBe(true);
        expect(pack[7].rarity).toBe("rare");
      }
    }
  });

  it("respecte les chances des boosters avant Soul of the Duelist", () => {
    const packs = Array.from({ length: 20_000 }, () => drawPack(booster("LOB")));
    expectOdds(packs, 8, ["super"], 1 / 6);
    expectOdds(packs, 8, ["ultra"], 1 / 12);
    expectOdds(packs, 8, ["secret"], 1 / 31);
    // 15 shortprints, chacune 3 fois plus rare qu'une des 67 communes.
    expectOdds(packs, 0, ["shortprint"], 5 / 72);
  });

  it("respecte les chances des Ultimate Rares à partir de Soul of the Duelist", () => {
    const packs = Array.from({ length: 20_000 }, () => drawPack(booster("RDS")));
    expectOdds(packs, 8, ["super"], 1 / 6);
    expectOdds(packs, 8, ["ultra"], 1 / 24);
    expectOdds(packs, 8, ["ultimate"], 1 / 12);
    expectOdds(packs, 8, ["common"], 1 - 1 / 6 - 1 / 24 - 1 / 12);
  });
});
