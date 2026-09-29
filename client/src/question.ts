import { OcgLocation, OcgMessageType, OcgResponseType, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { EngineMessage, Message, Place } from "./board.ts";

// Cards outside the duel (location 0, such as the Deck Masters to declare) all have sequence 0: their code tells them apart.
export const placeKey = (place: Place & { code?: number }) => `${place.controller}:${place.location}:${place.location ? place.sequence : place.code}`;

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

export type Point = { x: number; y: number };
// A press of the mouse or a finger, where a drag may start.
export type Appui = { clientX: number; clientY: number; pointerId: number; button: number };

// Where a click landed: the pointer, or above the middle of the element when the keyboard clicked it.
export function pointDe(event: { detail: number; clientX: number; clientY: number; currentTarget: EventTarget | null }): Point {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const r = (event.currentTarget as Element).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

// System string 31: asked when a monster that can attack directly also has monsters to attack.
const ATTAQUE_DIRECTE = "31";

// The answer a drop already gave to the next question: the zone or the monster it landed on, or a direct attack (visee without a zone, the opponent's number).
export function reponseVisee(question: EngineMessage, visee: string): OcgResponse | undefined {
  switch (question.type) {
    case OcgMessageType.SELECT_PLACE: {
      const zone = freePlaces(question.player, question.field_mask).find((free) => placeKey(free) === visee);
      if (question.count !== 1 || !zone) return undefined;
      return { type: OcgResponseType.SELECT_PLACE, places: [{ player: zone.controller, location: zone.location, sequence: zone.sequence }] };
    }
    case OcgMessageType.SELECT_CARD: {
      const index = question.selects.findIndex((card) => placeKey(card) === visee);
      return index < 0 || question.min > 1 ? undefined : { type: OcgResponseType.SELECT_CARD, indicies: [index] };
    }
    case OcgMessageType.SELECT_YESNO:
      return question.description === ATTAQUE_DIRECTE ? { type: OcgResponseType.SELECT_YESNO, yes: !visee.includes(":") } : undefined;
    default:
      return undefined;
  }
}
