import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardInfo, clientCard } from "../src/cards.ts";
import { deckError } from "../src/deckcheck.ts";
import { isAllowed } from "../src/pool.ts";

type Cards = [code: number, copies: number, name: string][];
const decks: { id: string; title: string; description: string; main: Cards; extra: Cards }[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "data", "suggested-decks.json"), "utf-8"),
);
const expand = (cards: Cards) => cards.flatMap(([code, copies]) => Array<number>(copies).fill(code));
const everything = new Map(decks.flatMap((deck) => [...deck.main, ...deck.extra]).map(([code]) => [code, 3]));

describe("decks suggérés", () => {
  it("en propose 6 à 8, chacun avec un titre et une description", () => {
    expect(decks.length).toBeGreaterThanOrEqual(6);
    expect(decks.length).toBeLessThanOrEqual(8);
    expect(new Set(decks.map((deck) => deck.id)).size).toBe(decks.length);
    expect(decks.filter((deck) => !deck.title.trim() || !deck.description.trim())).toEqual([]);
  });

  it.each(decks.map((deck) => [deck.id, deck] as const))("%s : 40 cartes du pool, 3 exemplaires au plus, fusions dans l'extra", (_id, deck) => {
    expect(expand(deck.main)).toHaveLength(40);
    expect(expand([...deck.main, ...deck.extra]).filter((code) => !isAllowed(code))).toEqual([]);
    const lookup = (code: number) => cardInfo(code);
    expect(deckError({ name: deck.title, main: expand(deck.main), extra: expand(deck.extra) }, lookup, everything)).toBeUndefined();
  });

  it("donne à chaque code le nom français de la carte", () => {
    const wrong = decks.flatMap((deck) => [...deck.main, ...deck.extra]).filter(([code, , name]) => clientCard(code)?.name !== name);
    expect(wrong).toEqual([]);
  });
});
