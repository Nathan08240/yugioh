import { describe, expect, it } from "vitest";
import { poolCard } from "../src/collection.ts";
import { deckError, limitError, overLimit, type DeckCard, type DeckDraft } from "../src/deckcheck.ts";

// Codes 1 to 30: normal monsters, 100 to 120: fusions, 1001 and 1002: artworks of 1000, 2001: "treated as" 1000.
const monster = (name: string, alias = 0): DeckCard => ({ name, type: 0x11, alias });
const cards = new Map<number, DeckCard>([
  ...Array.from({ length: 30 }, (_, i) => [i + 1, monster(`Monstre ${i + 1}`)] as const),
  ...Array.from({ length: 21 }, (_, i) => [i + 100, { name: `Fusion ${i + 100}`, type: 0x41, alias: 0 }] as const),
  [1000, monster("Original")],
  [1001, monster("Illustration 1", 1000)],
  [1002, monster("Illustration 2", 1000)],
  [2001, monster("Traité comme", 1000)],
]);
const lookup = (code: number) => cards.get(code);
const owned = new Map([...cards.keys()].map((code) => [code, 9]));

// 40 cards: 3 copies of monsters 1 to 13, plus monster 14.
const main40 = [...Array.from({ length: 39 }, (_, i) => Math.floor(i / 3) + 1), 14];
const deck = (patch: Partial<DeckDraft>): DeckDraft => ({ name: "Deck", main: main40, extra: [], ...patch });
const error = (patch: Partial<DeckDraft>, collection = owned) => deckError(deck(patch), lookup, collection);

describe("règles du deck", () => {
  it("accepte un deck de 40 à 60 cartes avec un extra deck de fusions", () => {
    expect(error({})).toBeUndefined();
    expect(error({ main: [...main40, ...Array.from({ length: 20 }, (_, i) => 15 + (i % 16))] })).toBeUndefined();
    expect(error({ extra: Array.from({ length: 15 }, (_, i) => 100 + i) })).toBeUndefined();
  });

  it("refuse un main deck de moins de 40 ou plus de 60 cartes", () => {
    expect(error({ main: main40.slice(1) })).toBe("le main deck doit compter 40 à 60 cartes");
    const main61 = [...main40, ...Array.from({ length: 21 }, (_, i) => 15 + (i % 16))];
    expect(error({ main: main61 })).toBe("le main deck doit compter 40 à 60 cartes");
  });

  it("refuse un extra deck de plus de 15 cartes", () => {
    expect(error({ extra: Array.from({ length: 16 }, (_, i) => 100 + i) })).toBe("l'extra deck compte 15 cartes au plus");
  });

  it("réserve l'extra deck aux fusions, et le main deck n'en contient pas", () => {
    expect(error({ extra: [20] })).toBe("Monstre 20 : l'extra deck n'accepte que des monstres de fusion");
    expect(error({ main: [...main40.slice(1), 100] })).toBe("Fusion 100 : les monstres de fusion vont dans l'extra deck");
  });

  it("limite à 3 exemplaires, variantes d'illustration comprises, mais pas les cartes « traitées comme »", () => {
    expect(error({ main: [...main40.slice(0, -1), 1] })).toBe("Monstre 1 : 3 exemplaires au plus");
    expect(error({ main: [...main40.slice(4), 1000, 1001, 1002, 1001, 14] })).toBe("Original : 3 exemplaires au plus");
    expect(error({ main: [...main40.slice(3), 1000, 1001, 1002] })).toBeUndefined();
    expect(error({ main: [...main40.slice(6), 1000, 1000, 1000, 2001, 2001, 2001] })).toBeUndefined();
  });

  it("refuse plus d'exemplaires que possédés, variante par variante", () => {
    const collection = new Map([...owned, [1, 2], [1001, 1]]);
    expect(error({}, collection)).toBe("Monstre 1 : plus d'exemplaires que dans la collection");
    expect(error({ main: [...main40.slice(3), 1000, 1000, 1001] }, new Map([...owned, [1000, 3], [1001, 0]]))).toBe(
      "Illustration 1 : plus d'exemplaires que dans la collection",
    );
  });

  it("refuse une carte hors du pool autorisé et un nom vide ou trop long", () => {
    expect(error({ main: [...main40.slice(1), 999] })).toBe("carte non autorisée : 999");
    expect(error({ name: "  " })).toBe("le nom du deck doit faire 1 à 40 caractères");
    expect(error({ name: "x".repeat(41) })).toBe("le nom du deck doit faire 1 à 40 caractères");
  });

  it("lit les vraies cartes du pool : fusions, Harpie Lady 1 distincte de Harpie Lady, cartes hors pool", () => {
    expect(poolCard(45231177)).toMatchObject({ name: "Spadassin des Flammes", type: expect.any(Number) });
    expect(poolCard(21844576)).toBeUndefined(); // Elemental HERO Avian
    const harpies = [76812113, 76812113, 76812113, 91932350, 91932350, 91932350];
    const main = [...main40.slice(6), ...harpies];
    const real = (code: number) => (code < 100 ? lookup(code) : poolCard(code));
    expect(deckError(deck({ main }), real, new Map([...owned, [76812113, 3], [91932350, 3]]))).toBeUndefined();
    expect(deckError(deck({ main: [...main40.slice(1), 45231177] }), real, new Map([...owned, [45231177, 1]]))).toBe(
      "Spadassin des Flammes : les monstres de fusion vont dans l'extra deck",
    );
  });
});

describe("liste de cartes limitées", () => {
  // Monstre 1 limited, Monstre 2 forbidden, Monstre 3 semi-limited, the artworks of 1000 limited.
  const limits = new Map([[1, 1], [2, 0], [3, 2], [1000, 1]]);

  it("liste chaque carte en trop une fois, avec son nombre maximum", () => {
    expect(overLimit([1, 2, 3, 3, 1, 4], lookup, limits)).toEqual([{ name: "Monstre 1", max: 1, copies: 2 }, { name: "Monstre 2", max: 0, copies: 1 }]);
    expect(overLimit([1, 3, 3, 4, 4, 4], lookup, limits)).toEqual([]);
  });

  it("compte les illustrations alternatives comme la carte d'origine, pas les cartes « traitées comme »", () => {
    expect(overLimit([1000, 1001], lookup, limits)).toEqual([{ name: "Original", max: 1, copies: 2 }]);
    expect(overLimit([1001, 1002], lookup, limits)).toEqual([{ name: "Illustration 1", max: 1, copies: 2 }]);
    expect(overLimit([1000, 2001], lookup, limits)).toEqual([]);
  });

  it("ignore les cartes hors pool", () => {
    expect(overLimit([999, 999, 1], lookup, new Map([[999, 1]]))).toEqual([]);
  });

  it("écrit un message par carte en trop, avec le lieu", () => {
    expect(limitError([1, 1, 4], lookup, limits, "en classé")).toBe("Monstre 1 : 1 exemplaire au plus en classé");
    expect(limitError([3, 3, 3, 2], lookup, limits, "en événement")).toBe("Monstre 3 : 2 exemplaires au plus en événement ; Monstre 2 : interdite en événement");
    expect(limitError([1, 3, 3], lookup, limits, "en classé")).toBeUndefined();
  });
});
