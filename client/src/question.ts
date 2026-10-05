import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, SelectBattleCMDAction, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { Card, EngineMessage, Message, Place } from "./board.ts";
import { cardName, type Cards } from "./cards.ts";
import { fold } from "./collection.ts";
import type { Chaines } from "./reglages.ts";

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

// Nothing can be chained (or the player chose never to be asked): pass without asking, as EDOPro does.
export function autoAnswer(question: Message, chaines: Chaines = "auto"): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_CHAIN && !question.forced && (question.selects.length === 0 || chaines === "jamais")) {
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
export const ATTAQUE_DIRECTE = "31";

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

// Current stats of a monster, else the printed ones (a negative value is a "?" ATK/DEF).
const stat = (cards: Cards, card: Card, key: "atk" | "def") => {
  const value = card[key] ?? cards.get(card.code)?.[key];
  return value === undefined || value < 0 ? undefined : value;
};
const degats = (n: number) => `${n} ${n > 1 ? "dégâts" : "dégât"}`;

function contreAttaque(atk: number, cible: number, adversaire: string): string {
  if (atk === cible) return "Les deux monstres sont détruits, pas de dégâts.";
  if (atk > cible) return `Le monstre adverse est détruit, ${degats(atk - cible)} à ${adversaire}.`;
  return `Votre monstre est détruit, ${degats(cible - atk)} pour vous.`;
}

function contreDefense(atk: number, cible: number): string {
  if (atk > cible) return "Le monstre adverse est détruit, pas de dégâts.";
  if (atk === cible) return "Aucun monstre détruit, pas de dégâts.";
  return `Aucun monstre détruit, ${degats(cible - atk)} pour vous.`;
}

// What a battle would give from the current stats, card effects left aside. `cible` null: a direct attack. Undefined when a stat is unknown.
export function apercuCombat(cards: Cards, attaquant: Card, cible: Card | null, adversaire: string): string | undefined {
  const atk = stat(cards, attaquant, "atk");
  if (atk === undefined) return undefined;
  if (!cible) return `${degats(atk)} à ${adversaire}.`;
  if (cible.position & OcgPosition.FACEDOWN) return "Monstre face cachée : DEF inconnue (?). Restez prudent.";
  const defense = (cible.position & OcgPosition.DEFENSE) !== 0;
  const valeur = stat(cards, cible, defense ? "def" : "atk");
  if (valeur === undefined) return undefined;
  return defense ? contreDefense(atk, valeur) : contreAttaque(atk, valeur, adversaire);
}

// The attacker (zone key) once a battle command, or the direct-attack question that follows it, is answered: the target question comes next.
export function attaquantChoisi(question: EngineMessage | undefined, response: OcgResponse, courant?: string): string | undefined {
  if (question?.type === OcgMessageType.SELECT_BATTLECMD) {
    if (response.type !== OcgResponseType.SELECT_BATTLECMD || response.action !== SelectBattleCMDAction.SELECT_BATTLE || response.index === null) return undefined;
    return placeKey(question.attacks[response.index]);
  }
  return question?.type === OcgMessageType.SELECT_YESNO && question.description === ATTAQUE_DIRECTE ? courant : undefined;
}

// Names to declare: the player's deck as the server sent it (most numerous first) until a search is typed, then the accepted cards whose name matches, by name.
export function declarables(codes: readonly number[], deck: readonly number[], cards: Cards, search: string) {
  const wanted = fold(search.trim());
  const named = (list: readonly number[]) => list.map((code) => ({ code, name: cardName(cards, code) }));
  if (!wanted && deck.length > 0) return { found: named(deck), ownDeck: true };
  const found = named(codes).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { found: wanted ? found.filter(({ name }) => fold(name).includes(wanted)) : found, ownDeck: false };
}
