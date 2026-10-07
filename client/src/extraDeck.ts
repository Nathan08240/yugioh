import { OcgMessageType, OcgResponseType, SelectIdleCMDAction, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { countBy, isExtraDeck, sameCard } from "../../server/src/deckcheck.ts";
import type { CardInfo } from "../../server/src/protocol.ts";
import type { EngineMessage, Side } from "./board.ts";
import type { Cards } from "./cards.ts";

export { isExtraDeck };

export const POLYMERIZATION = 24094653;
// Spells that bring an Extra Deck monster in from the materials of the hand and the field: the duel panel offers to play them.
const SUMMON_SPELLS: ReadonlySet<number> = new Set([POLYMERIZATION]);

// Copies by passcode.
export type Counts = ReadonlyMap<number, number>;
export type Material = { code: number; copies: number };

// Copies by passcode of the original card: an alternate artwork counts as the card it reprints.
export function byOriginal(quantities: Iterable<readonly [number, number]>, cards: Cards): Map<number, number> {
  const total = new Map<number, number>();
  for (const [code, quantity] of quantities) {
    const card = cards.get(code);
    const key = card ? sameCard(code, card) : code;
    total.set(key, (total.get(key) ?? 0) + quantity);
  }
  return total;
}

// The named materials of an Extra Deck monster with the copies of each (the server read them from its script),
// undefined when they are not named cards.
export function materialsOf(card: Pick<CardInfo, "materials">): Material[] | undefined {
  return card.materials && [...countBy(card.materials)].map(([code, copies]) => ({ code, copies }));
}

export const hasCopies = (have: Counts, { code, copies }: Material) => (have.get(code) ?? 0) >= copies;

// Whether `have` holds every named material of the monster. ponytail: Fusion Substitute monsters are not counted.
export const covers = (card: CardInfo, have: Counts): boolean => materialsOf(card)?.every((material) => hasCopies(have, material)) ?? false;

// A main deck summons the monster when it holds its materials and Polymerization.
export const summonableFrom = (card: CardInfo, main: Counts): boolean => (main.get(POLYMERIZATION) ?? 0) > 0 && covers(card, main);

// Where a material stands for a deck: enough copies in the main deck, owned but outside it, or not owned (enough).
export type Mark = "deck" | "owned" | "missing";

export function markOf(material: Material, main: Counts, owned: Counts): Mark {
  if (hasCopies(main, material)) return "deck";
  return hasCopies(owned, material) ? "owned" : "missing";
}

// Monsters of the hand and of the Monster Zones of a side: what a Fusion Spell can use. A card whose code is hidden is left out.
export function atHand({ hand, monsters }: Side, cards: Cards): Map<number, number> {
  return byOriginal([...hand, ...monsters].flatMap((card) => (card?.code ? [[card.code, 1] as const] : [])), cards);
}

export type Listed = { code: number; copies: number; materials: (Material & { have: boolean })[]; reunited: boolean };

// The Extra Deck as the duel panel lists it, each monster once with its copies: the ones whose materials `have` holds first, then by name.
export function listExtra(codes: number[], have: Counts, cards: Cards): Listed[] {
  const listed = [...countBy(codes)].map(([code, copies]): Listed => {
    const info = cards.get(code);
    const needed = (info && materialsOf(info)) ?? [];
    const materials = needed.map((material) => ({ ...material, have: hasCopies(have, material) }));
    return { code, copies, materials, reunited: materials.length > 0 && materials.every((material) => material.have) };
  });
  const name = (code: number) => cards.get(code)?.name ?? "";
  return listed.sort((a, b) => Number(b.reunited) - Number(a.reunited) || name(a.code).localeCompare(name(b.code), "fr"));
}

// The Fusion Spell of the hand the engine offers in the current idle command: its passcode and the answer that activates it.
export function summonSpell(question: EngineMessage | undefined): { code: number; response: OcgResponse } | undefined {
  if (question?.type !== OcgMessageType.SELECT_IDLECMD) return undefined;
  const index = question.activates.findIndex(({ code }) => SUMMON_SPELLS.has(code));
  if (index < 0) return undefined;
  return { code: question.activates[index].code, response: { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index } };
}
