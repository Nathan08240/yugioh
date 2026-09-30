import { expect, it } from "vitest";
import type { DeckCard } from "../../server/src/deckcheck.ts";
import { drawHand, fitSuggestion, formatYdk, importDeck, parseYdk } from "./deckTools.ts";

const pool = new Map<number, DeckCard>([
  [1, { name: "Dark Magician", type: 0x11, alias: 0 }],
  [2, { name: "Dark Hole", type: 0x2, alias: 0 }],
  [3, { name: "Gaia", type: 0x41, alias: 0 }],
]);
const card = (code: number) => pool.get(code);

it("formate un .ydk EDOPro", () => {
  expect(formatYdk({ main: [1, 1, 2], extra: [3] })).toBe("#created by yugioh\n#main\n1\n1\n2\n#extra\n3\n!side\n");
});

it("lit un .ydk : commentaires, lignes vides, side ignoré, codes invalides", () => {
  const text = "#created by x\r\n#main\r\n1\r\n\r\n2\r\n#extra\r\n3\r\n!side\r\n2\r\nabc\r\n#main\r\n-5\r\n1.5\r\n0";
  expect(parseYdk(text)).toEqual({ main: [1, 2], extra: [3], invalid: ["abc", "-5", "1.5", "0"] });
  expect(parseYdk("1\n2\n2")).toEqual({ main: [1, 2, 2], extra: [], invalid: [] });
  expect(parseYdk(formatYdk({ main: [1, 2], extra: [3] }))).toEqual({ main: [1, 2], extra: [3], invalid: [] });
});

it("importe en écartant hors pool, non possédées et exemplaires en trop", () => {
  const owned = new Map([[1, 2], [3, 1]]);
  const result = importDeck({ main: [1, 1, 1, 2, 99, 3], extra: [3] }, card, owned);
  expect(result.main).toEqual([1, 1]);
  expect(result.extra).toEqual([3]);
  expect(result.skipped).toEqual([
    { code: 1, reason: "trop d'exemplaires" },
    { code: 2, reason: "non possédée" },
    { code: 99, reason: "hors pool" },
    { code: 3, reason: "trop d'exemplaires" },
  ]);
});

it("tire la main sans toucher au deck, sans dépasser sa taille", () => {
  const main = [10, 11, 12, 13, 14, 15, 16];
  expect(drawHand(main, () => 0)).toEqual([10, 11, 12, 13, 14]);
  expect(drawHand(main, () => 0.999)).toEqual([16, 10, 11, 12, 13]);
  expect(new Set(drawHand(main)).size).toBe(5);
  expect(drawHand([1, 2])).toHaveLength(2);
  expect(drawHand([])).toEqual([]);
  expect(main).toEqual([10, 11, 12, 13, 14, 15, 16]);
});

it("ajuste un deck suggéré à la collection : cartes possédées, manquantes à part, fusion dans l'extra", () => {
  const suggestion = { main: [[1, 3, "Dark Magician"], [2, 1, "Dark Hole"]] as [number, number, string][], extra: [[3, 1, "Gaia"]] as [number, number, string][] };
  const result = fitSuggestion(suggestion, card, new Map([[1, 2], [3, 1]]));
  expect(result).toEqual({ main: [1, 1], extra: [3], missing: [[1, 1], [2, 1]] });
  expect(fitSuggestion(suggestion, card, new Map([[1, 3], [2, 1], [3, 1]])).missing).toEqual([]);
});
