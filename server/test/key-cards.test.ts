import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { clientCard } from "../src/cards.ts";
import { COPIES_MAX } from "../src/deckcheck.ts";
import { isAllowed } from "../src/pool.ts";

type Key = [code: number, tier: number, copies: number, name: string];
const keys: Key[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "key-cards.json"), "utf-8"));

it("cartes clés : codes du pool, nom français exact, palier 1 à 3, sans doublon", () => {
  expect(keys.filter(([code]) => !isAllowed(code))).toEqual([]);
  expect(keys.filter(([code, , , name]) => clientCard(code)?.name !== name)).toEqual([]);
  expect(keys.filter(([, tier, copies]) => ![1, 2, 3].includes(tier) || copies < 1 || copies > COPIES_MAX)).toEqual([]);
  expect(new Set(keys.map(([code]) => code)).size).toBe(keys.length);
});

it("cartes clés : aucune fusion, rituel ni monstre à invocation spéciale seulement", () => {
  const unfit = OcgType.FUSION | OcgType.RITUAL | OcgType.SPSUMMON;
  expect(keys.filter(([code]) => ((clientCard(code)?.type ?? 0) & unfit) !== 0)).toEqual([]);
});
