import { OcgAttribute, OcgType } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { countBy, deckError } from "../../server/src/deckcheck.ts";
import type { CardInfo } from "../../server/src/protocol.ts";
import { buildDeck, type Theme } from "./constructeur.ts";

const { MONSTER, NORMAL, EFFECT, FUSION, SPELL, TRAP, FIELD } = OcgType;
const card = (name: string, type: number, stats: Partial<CardInfo> = {}): CardInfo => ({
  name, alias: 0, desc: "", type, level: 0, attribute: 0, race: 0, atk: 0, def: 0, strings: [], attributeName: "", typeLine: "", image: false, ...stats,
});
const WARRIOR = { race: 1, typeLine: "Guerrier / Normal", attribute: OcgAttribute.EARTH, attributeName: "TERRE" };
const DRAGON = { race: 8192, typeLine: "Dragon / Normal", attribute: OcgAttribute.WIND, attributeName: "VENT" };
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

const POT = 55144522;
const MIRROR = 44095762;
const SANGAN = 26202165;
const POLY = 24094653;
const SOGEN = 4100;
const MOUNTAIN = 4101;
const BEAST_FIELD = 4102;
const cards = new Map<number, CardInfo>([
  ...range(1001, 12).map((code, i) => [code, card(`Guerrier ${i + 1}`, MONSTER | NORMAL, { ...WARRIOR, level: 4, atk: 1100 + 100 * i, def: 1000 })] as const),
  ...range(2001, 12).map((code, i) => [code, card(`Dragon ${i + 1}`, MONSTER | NORMAL, { ...DRAGON, level: 4, atk: 1100 + 100 * i, def: 1000 })] as const),
  ...range(3001, 6).map((code, i) => [code, card(`Grand Dragon ${i + 1}`, MONSTER | NORMAL, { ...DRAGON, attribute: OcgAttribute.LIGHT, level: i < 3 ? 6 : 8, atk: 2600 + 100 * i, def: 2000 })] as const),
  ...range(4001, 10).map((code, i) => [code, card(`Magie ${i + 1}`, SPELL, { desc: "Piochez 1 carte." })] as const),
  ...range(5001, 10).map((code, i) => [code, card(`Piège ${i + 1}`, TRAP)] as const),
  [SOGEN, card("Sogen", SPELL | FIELD, { desc: "Tous les monstres Guerrier et Bête-Guerrier sur le Terrain gagnent 200 ATK/DEF." })],
  [BEAST_FIELD, card("Steppe", SPELL | FIELD, { desc: "Tous les monstres Bête-Guerrier sur le Terrain gagnent 200 ATK/DEF." })],
  [7001, card("Bête Guerrière", MONSTER | NORMAL, { race: 32768, typeLine: "Bête-Guerrier / Normal", level: 4, atk: 1000 })],
  [MOUNTAIN, card("Montagne", SPELL | FIELD, { desc: "Tous les monstres Dragon, Bête Ailée et Tonnerre sur le Terrain gagnent 200 ATK/DEF." })],
  [POT, card("Pot de Cupidité", SPELL)],
  [MIRROR, card("Force de Miroir", TRAP)],
  [SANGAN, card("Sangan", MONSTER | EFFECT, { race: 8, typeLine: "Démon / Effet", attribute: OcgAttribute.DARK, attributeName: "TÉNÈBRES", level: 3, atk: 1000, def: 600 })],
  [POLY, card("Polymérisation", SPELL)],
  [6001, card("Guerrier Dragon", MONSTER | FUSION, { level: 7, atk: 2800, desc: '"Guerrier 1" + "Dragon 1"\nUn monstre de fusion.' })],
  [6002, card("Dragon Absent", MONSTER | FUSION, { level: 7, atk: 3000, desc: '"Guerrier 1" + "Dragon Inconnu"' })],
]);
const lookup = (code: number) => cards.get(code);
const everything = new Map([...cards.keys()].filter((code) => code !== 7001).map((code) => [code, 3]));
const guerrier: Theme = { kind: "race", value: 1, label: "Guerrier" };
const monsters = (codes: number[]) => codes.map((code) => cards.get(code) as CardInfo).filter((info) => info.type & MONSTER);

function checkRules(main: number[], extra: number[], owned: ReadonlyMap<number, number>) {
  expect(deckError({ name: "Deck", main, extra }, lookup, owned)).toBeUndefined();
  const levels = monsters(main).map((info) => info.level);
  expect(levels.filter((level) => level >= 5).length).toBeLessThanOrEqual(4);
  expect(levels.filter((level) => level >= 7).length).toBeLessThanOrEqual(2);
}

describe("construction automatique", () => {
  it("le plus fort : 40 cartes valides, cartes clés d'abord, ~18 monstres surtout de niveau 4 ou moins", () => {
    const built = buildDeck(cards, everything);
    expect(built.main).toHaveLength(40);
    checkRules(built.main, built.extra, everything);
    expect(built.keys).toEqual([POT, MIRROR, SANGAN]);
    expect(monsters(built.main)).toHaveLength(18);
    expect(monsters(built.main).filter((info) => info.level <= 4).length).toBeGreaterThanOrEqual(14);
    expect(built.levels.reduce((sum, [, count]) => sum + count, 0)).toBe(18);
    expect(buildDeck(cards, everything)).toEqual(built);
  });

  it("respecte les exemplaires possédés, jamais plus de 3", () => {
    const one = new Map([...cards.keys()].map((code) => [code, 1]));
    const built = buildDeck(cards, one);
    expect(Math.max(...countBy(built.main).values())).toBe(1);
    checkRules(built.main, built.extra, one);
    const many = new Map([...cards.keys()].map((code) => [code, 9]));
    expect(Math.max(...countBy(buildDeck(cards, many).main).values())).toBe(3);
  });

  it("thème : les monstres du Type, sa Magie de Terrain, pas celle d'un autre Type", () => {
    const built = buildDeck(cards, everything, { theme: guerrier });
    expect(built.main).toHaveLength(40);
    expect(monsters(built.main).every((info) => info.race === 1)).toBe(true);
    expect(built.main).toContain(SOGEN);
    expect(built.main).not.toContain(MOUNTAIN);
    expect(built.main).not.toContain(BEAST_FIELD);
    expect(built.keys).toEqual([POT, MIRROR]);
  });

  it("met une fusion dans l'Extra Deck seulement avec Polymérisation et ses matériaux", () => {
    const owned = new Map([[POLY, 1], [1001, 3], [2001, 3], [6001, 1], [6002, 1]]);
    expect(buildDeck(cards, owned).extra).toEqual([6001]);
    expect(buildDeck(cards, new Map([...owned].filter(([code]) => code !== POLY))).extra).toEqual([]);
    expect(buildDeck(cards, new Map([...owned].filter(([code]) => code !== 2001))).extra).toEqual([]);
  });

  it("compléter garde les cartes choisies, même hors thème, et l'Extra Deck", () => {
    const keep = { main: [MOUNTAIN, MOUNTAIN, 2012], extra: [6002] };
    const built = buildDeck(cards, everything, { theme: guerrier }, keep);
    expect(built.main.slice(0, 3)).toEqual(keep.main);
    expect(built.main).toHaveLength(40);
    expect(built.extra[0]).toBe(6002);
    checkRules(built.main, built.extra, everything);
    const full = range(1001, 12).flatMap((code) => [code, code, code]).concat(range(4001, 4));
    expect(buildDeck(cards, everything, {}, { main: full, extra: [] }).main).toEqual(full);
  });

  it("part d'un deck suggéré : ses cartes possédées d'abord", () => {
    const base = { main: [[3004, 3, "Grand Dragon 4"], [4005, 2, "Magie 5"], [9999, 1, "Absente"]] as [number, number, string][], extra: [] };
    const built = buildDeck(cards, everything, { base });
    expect(built.main.slice(0, 5)).toEqual([3004, 3004, 3004, 4005, 4005]);
    expect(built.main).toHaveLength(40);
  });

  it("collection trop petite : deck incomplet, sans erreur, avec les cartes clés manquantes", () => {
    const owned = new Map([[1001, 2], [5001, 1], [POT, 1]]);
    const built = buildDeck(cards, owned);
    expect(built.main.toSorted()).toEqual([1001, 1001, 5001, POT].toSorted());
    expect(deckError({ name: "Deck", ...built }, lookup, owned)).toMatch(/40/);
    expect(built.missing).toEqual([MIRROR, SANGAN]);
  });
});
