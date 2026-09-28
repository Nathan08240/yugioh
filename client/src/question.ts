import { OcgLocation, OcgMessageType, OcgResponseType, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { Message, Place } from "./board.ts";

export const placeKey = (place: Place) => `${place.controller}:${place.location}:${place.sequence}`;

// Bits of field_mask, set for every zone that cannot be chosen: 0-4 own monsters, 8-12 own S/T, 13 field zone, +16 opponent.
const ZONES = [
  ...[0, 1, 2, 3, 4].map((sequence) => ({ bit: sequence, location: OcgLocation.MZONE, sequence })),
  ...[0, 1, 2, 3, 4, 5].map((sequence) => ({ bit: 8 + sequence, location: OcgLocation.SZONE, sequence })),
];

export function freePlaces(player: number, fieldMask: number): Place[] {
  return [0, 16].flatMap((offset) =>
    ZONES.filter(({ bit }) => ((fieldMask >>> (bit + offset)) & 1) === 0).map(({ location, sequence }) => ({
      controller: offset ? 1 - player : player,
      location,
      sequence,
    })),
  );
}

// Nothing can be chained: pass without asking, as EDOPro does.
export function autoAnswer(question: Message): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_CHAIN && question.selects.length === 0 && !question.forced) {
    return { type: OcgResponseType.SELECT_CHAIN, index: null };
  }
  return undefined;
}
