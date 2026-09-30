import { OcgOpCode } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { announceCard, declarable } from "../src/announce.ts";

// Serment de l'Archdémon: any card outside the Extra Deck (TYPE_EXTRA, ISTYPE, NOT).
const NOT_EXTRA = [0x4802040n, OcgOpCode.ISTYPE, OcgOpCode.NOT] as OcgOpCode[];

it("donne les cartes du pool que le filtre de déclaration accepte", () => {
  const codes = declarable(NOT_EXTRA);
  expect(codes).toContain(46986414); // Magicien Sombre
  expect(codes).not.toContain(66889139); // Gaïa le Dragon Champion, une Fusion
  expect(announceCard(NOT_EXTRA)).toBe(codes[0]);
});
