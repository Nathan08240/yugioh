import { OcgAttribute, OcgType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { filterCollection, kindCounts, noFilters, type Filters } from "./collection.ts";

const card = (name: string, type: number, stats: Partial<CardInfo> = {}): CardInfo => ({
  name, alias: 0, desc: "", type, level: 0, attribute: 0, race: 0, atk: 0, def: 0, strings: [], attributeName: "", typeLine: "", image: false, ...stats,
});
const cards = new Map([
  [1, card("Dark Magician", OcgType.MONSTER | OcgType.NORMAL, { level: 7, attribute: OcgAttribute.DARK, atk: 2500, def: 2100 })],
  [2, card("Blue-Eyes White Dragon", OcgType.MONSTER | OcgType.NORMAL, { level: 8, attribute: OcgAttribute.LIGHT, atk: 3000, def: 2500 })],
  [3, card("Mystical Elf", OcgType.MONSTER | OcgType.NORMAL, { level: 4, attribute: OcgAttribute.LIGHT, atk: 800, def: 2000 })],
  [4, card("Dark Hole", OcgType.SPELL)],
  [5, card("Mirror Force", OcgType.TRAP)],
  [6, card("Slifer", OcgType.MONSTER | OcgType.EFFECT, { level: 10, atk: -2, def: -2 })],
  [7, card("Gaia the Dragon Champion", OcgType.MONSTER | OcgType.FUSION, { level: 5, attribute: OcgAttribute.WIND, atk: 2600, def: 2100 })],
]);
const owned: [number, number][] = [[1, 2], [2, 3], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [99, 1]];
const names = (filters: Partial<Filters>) => filterCollection(owned, cards, { ...noFilters, ...filters }).map(([code]) => cards.get(code)?.name);

it("filtre la collection par nom, type, attribut, niveau et ATK/DEF", () => {
  expect(names({})).toEqual(["Blue-Eyes White Dragon", "Dark Hole", "Dark Magician", "Gaia the Dragon Champion", "Mirror Force", "Mystical Elf", "Slifer"]);
  expect(names({ name: " dark " })).toEqual(["Dark Hole", "Dark Magician"]);
  expect(names({ kind: "trap" })).toEqual(["Mirror Force"]);
  expect(names({ kind: "monster", attribute: OcgAttribute.LIGHT })).toEqual(["Blue-Eyes White Dragon", "Mystical Elf"]);
  expect(names({ level: 7 })).toEqual(["Dark Magician"]);
  expect(names({ kind: "fusion" })).toEqual(["Gaia the Dragon Champion"]);
  expect(names({ atk: ["2000", ""] })).toEqual(["Blue-Eyes White Dragon", "Dark Magician", "Gaia the Dragon Champion"]);
  expect(names({ atk: ["", "1000"], def: ["2000", "2000"] })).toEqual(["Mystical Elf"]);
  expect(filterCollection(owned, cards, { ...noFilters, name: "elf" })).toEqual([[3, 1]]);
});

it("compte les monstres, magies et pièges d'un deck", () => {
  expect(kindCounts([1, 1, 2, 4, 5, 5, 7], cards)).toEqual({ monster: 4, spell: 1, trap: 2 });
});
