// Layout of the 3D board and the scene computed from `Board` (design/3d.md). No three.js here: the lobby loads it for free.
import { OcgLocation, OcgPosition } from "@n1xx1/ocgcore-wasm";
import type { Board, Card } from "../board.ts";
import { has } from "../cards.ts";
import { placeKey } from "../question.ts";

// Unit: 10 cm. You (camp 0) in front, the opponent (camp 1) in central symmetry.
export const CARTE = { l: 0.59, h: 0.86, e: 0.01 };
export const ZONE = { l: 0.7, p: 0.96 };
export const PAS = { x: 0.8, z: 1.08 };
export const MILIEU = 0.28;
export const PLATEAU = { l: 3 * PAS.x + ZONE.l / 2 + 0.13, p: MILIEU + ZONE.p + PAS.z + 0.13 };

export type TypeZone = "terrain" | "monstre" | "magie" | "cimetiere" | "extra" | "deck";
export type Zone = { id: string; joueur: number; camp: 0 | 1; rangee: number; col: number; type: TypeZone; x: number; z: number };

// Row 0: Field, 5 Monsters, Graveyard (banished cards as a counter beside it). Row 1: Extra Deck, 5 Spell/Trap, Deck.
const { MZONE, SZONE, GRAVE, REMOVED, DECK, EXTRA } = OcgLocation;
const FIVE = [1, 2, 3, 4, 5];
const RANGEES: [TypeZone, OcgLocation, number | undefined][][] = [
  [["terrain", SZONE, 5], ...FIVE.map((col): [TypeZone, OcgLocation, number] => ["monstre", MZONE, col - 1]), ["cimetiere", GRAVE, undefined]],
  [["extra", EXTRA, undefined], ...FIVE.map((col): [TypeZone, OcgLocation, number] => ["magie", SZONE, col - 1]), ["deck", DECK, undefined]],
];

// A zone of the field is named by placeKey(); a pile by its player and location.
export const pileId = (joueur: number, location: number) => `${joueur}:${location}`;

export function centre(camp: number, rangee: number, col: number): { x: number; z: number } {
  const x = (col - 3) * PAS.x;
  const z = MILIEU + ZONE.p / 2 + rangee * PAS.z;
  return camp === 0 ? { x, z } : { x: -x, z: -z };
}

export function zones(seat: number): Zone[] {
  return [seat, 1 - seat].flatMap((joueur, camp) =>
    RANGEES.flatMap((rangee, r) =>
      rangee.map(([type, location, sequence], col) => ({
        id: sequence === undefined ? pileId(joueur, location) : placeKey({ controller: joueur, location, sequence }),
        joueur,
        camp: camp as 0 | 1,
        rangee: r,
        col,
        type,
        ...centre(camp, r, col),
      })),
    ),
  );
}

// Code 0: the back. A set card stays readable by its owner under a hatched veil; the opponent sees its back.
export type CarteScene = { code: number; defense: boolean; cachee: boolean; voile: boolean };
export type PileScene = { nombre: number; code: number };
export type EtatScene = { cartes: Map<string, CarteScene>; piles: Map<string, PileScene> };

function carteScene(card: Card, location: number, mine: boolean): CarteScene {
  const cachee = has(card.position, OcgPosition.FACEDOWN);
  return { code: card.code, defense: location === MZONE && has(card.position, OcgPosition.DEFENSE), cachee, voile: cachee && mine && card.code !== 0 };
}

export function etatScene(board: Board, seat: number): EtatScene {
  const cartes = new Map<string, CarteScene>();
  const piles = new Map<string, PileScene>();
  board.players.forEach((side, joueur) => {
    const poser = (location: OcgLocation, list: (Card | null)[]) =>
      list.forEach((card, sequence) => {
        if (card) cartes.set(placeKey({ controller: joueur, location, sequence }), carteScene(card, location, joueur === seat));
      });
    poser(MZONE, side.monsters.slice(0, 5));
    poser(SZONE, side.spells.slice(0, 6));
    piles.set(pileId(joueur, GRAVE), { nombre: side.grave.length, code: side.grave.at(-1)?.code ?? 0 });
    piles.set(pileId(joueur, REMOVED), { nombre: side.banished.length, code: side.banished.at(-1)?.code ?? 0 });
    piles.set(pileId(joueur, DECK), { nombre: side.deck, code: 0 });
    piles.set(pileId(joueur, EXTRA), { nombre: side.extra, code: 0 });
  });
  return { cartes, piles };
}

const PILES: ReadonlySet<number> = new Set([GRAVE, REMOVED, DECK, EXTRA]);

// The 3D zone of a question key: the field zone itself, the pile of a card in a pile, none for the hand.
export function zoneDe(key: string): string | undefined {
  const [controller, location] = key.split(":").map(Number);
  if (location === MZONE || location === SZONE) return key;
  if (PILES.has(location)) return pileId(controller, location);
  return undefined;
}

export function cibles3D(targets: Iterable<string>): Set<string> {
  const found = new Set<string>();
  for (const key of targets) {
    const zone = zoneDe(key);
    if (zone) found.add(zone);
  }
  return found;
}
