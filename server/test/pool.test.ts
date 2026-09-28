import { describe, expect, it } from "vitest";
import { cardName, readCard } from "../src/cards.ts";
import { KAIBA, RA_ANIME, YUGI } from "../src/decks.ts";
import { isAllowed, POOL, RARITIES, SETS } from "../src/pool.ts";

const printings = SETS.flatMap((set) => set.cards.map((card) => ({ set: set.code, ...card })));

describe("pool de cartes classiques", () => {
  it("contient les boosters LOB à FET et les starter decks de l'époque", () => {
    expect(SETS.map((set) => set.code)).toEqual([
      "LOB", "MRD", "MRL", "PSV", "LON", "LOD", "PGD", "MFC", "DCR", "IOC", "AST", "SOD", "RDS", "FET",
      "SDY", "SDK", "SDJ", "SDP",
    ]);
    expect(SETS.every((set) => set.name && /^\d{4}-\d{2}-\d{2}$/.test(set.date) && set.cards.length >= 50)).toBe(true);
  });

  it("n'a que des raretés connues", () => {
    expect(printings.filter((card) => !RARITIES.has(card.rarity))).toEqual([]);
  });

  it("n'a que des cartes présentes dans BabelCDB et aucune carte GX", () => {
    expect(printings.filter((card) => !readCard(card.code))).toEqual([]);
    expect([...POOL].map(cardName).filter((name) => name.includes("Elemental HERO"))).toEqual([]);
  });

  it("autorise les Dieux anime en liste blanche, hors boosters", () => {
    expect(isAllowed(RA_ANIME)).toBe(true);
    expect(printings.some((card) => card.code === RA_ANIME)).toBe(false);
    expect(isAllowed(21844576)).toBe(false); // Elemental HERO Avian
  });

  it("valide les decks existants", () => {
    expect([...YUGI, ...KAIBA].filter((code) => !isAllowed(code)).map(cardName)).toEqual([]);
  });
});
