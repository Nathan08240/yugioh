import { describe, expect, it } from "vitest";
import { poolCard } from "../src/collection.ts";
import { COPIES_MAX, countBy, EXTRA_MAX, isFusion, MAIN_MIN, sameCard, type DeckCard } from "../src/deckcheck.ts";
import { BOOSTERS } from "../src/boosters.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { botDeck, SEALED_PACKS, sealedDeckError, sealedPool } from "../src/sealed.ts";

describe("mode Scellé", () => {
  it("tire 6 boosters d'un même set", () => {
    const { set, cards } = sealedPool();
    const codes = new Set(BOOSTERS.get(set)?.cards.map((card) => card.code));
    expect(cards).toHaveLength(SEALED_PACKS * 9);
    expect(cards.every((card) => codes.has(card.code))).toBe(true);
  });

  it("construit le deck du bot avec ses propres boosters : fusions en Extra, 3 exemplaires au plus", () => {
    for (const set of BOOSTERS.keys()) {
      const { main, extra } = botDeck(set);
      const card = (code: number) => poolCard(code) as DeckCard;
      expect(main.length).toBeLessThanOrEqual(MAIN_MIN);
      expect(main.length).toBeGreaterThan(30);
      expect(main.some((code) => isFusion(card(code)))).toBe(false);
      expect(extra.length).toBeLessThanOrEqual(EXTRA_MAX);
      expect(extra.every((code) => isFusion(card(code)))).toBe(true);
      expect(Math.max(...countBy(main, (code) => sameCard(code, card(code))).values())).toBeLessThanOrEqual(COPIES_MAX);
    }
  });

  it("valide le deck contre la réserve seulement", () => {
    const pool = YUGI.map((code) => ({ code, rarity: "common" }));
    expect(sealedDeckError(pool, YUGI, [])).toBeUndefined();
    expect(sealedDeckError(pool, [...YUGI.slice(1), KAIBA[0]], [])).toBe("Dragon Blanc aux Yeux Bleus : plus d'exemplaires que dans la réserve");
  });
});
