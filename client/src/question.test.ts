import { OcgHintTiming, OcgLocation, OcgMessageType, OcgResponseType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import type { Message } from "./board.ts";
import { autoAnswer, freePlaces } from "./question.ts";

const { MZONE, SZONE } = OcgLocation;

it("liste les zones libres d'après le masque du moteur", () => {
  // Masks sent by the engine: monster zone 1 taken, then S/T zones 1-2 taken.
  expect(freePlaces(0, 4294967265)).toEqual([1, 2, 3, 4].map((sequence) => ({ controller: 0, location: MZONE, sequence })));
  expect(freePlaces(1, 0xffffffff & ~(0b111000 << 8))).toEqual([3, 4, 5].map((sequence) => ({ controller: 1, location: SZONE, sequence })));
  // Opponent zones come after 16 bits, from the asking player's point of view.
  expect(freePlaces(1, 0xffffffff & ~(1 << 16))).toEqual([{ controller: 0, location: MZONE, sequence: 0 }]);
});

it("passe tout seul une chaîne sans carte à activer", () => {
  const chain: Message = { type: OcgMessageType.SELECT_CHAIN, player: 0, spe_count: 0, forced: false, hint_timing: OcgHintTiming.DRAW_PHASE, hint_timing_other: OcgHintTiming.DRAW_PHASE, selects: [] };
  expect(autoAnswer(chain)).toEqual({ type: OcgResponseType.SELECT_CHAIN, index: null });
  expect(autoAnswer({ ...chain, forced: true })).toBeUndefined();
  expect(autoAnswer({ type: OcgMessageType.SELECT_YESNO, player: 0, description: "0" })).toBeUndefined();
});
