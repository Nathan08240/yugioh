import { OcgType } from "@n1xx1/ocgcore-wasm";
import type { CardInfo } from "../../server/src/protocol.ts";
import { has, type Cards } from "./cards.ts";

export type Kind = "" | "monster" | "spell" | "trap" | "fusion";

// Empty fields do not filter. Attribute, level and stats keep monsters only.
export type Filters = { name: string; kind: Kind; attribute: number; level: number; atk: [string, string]; def: [string, string] };

export const noFilters: Filters = { name: "", kind: "", attribute: 0, level: 0, atk: ["", ""], def: ["", ""] };

export function kindOf(type: number): "monster" | "spell" | "trap" {
  if (has(type, OcgType.SPELL)) return "spell";
  if (has(type, OcgType.TRAP)) return "trap";
  return "monster";
}

// Fusions are monsters too: the filter keeps them apart for the Extra Deck.
const kindMatches = (type: number, kind: Kind) => (kind === "fusion" ? has(type, OcgType.FUSION) : kindOf(type) === kind);

// Monsters, spells and traps of a deck, for its breakdown bar.
export function kindCounts(codes: readonly number[], cards: Cards): Record<"monster" | "spell" | "trap", number> {
  const counts = { monster: 0, spell: 0, trap: 0 };
  for (const code of codes) counts[kindOf(cards.get(code)?.type ?? 0)]++;
  return counts;
}

// A "?" stat (-2) never matches a set bound.
function inRange(value: number, [min, max]: [string, string]): boolean {
  if (min === "" && max === "") return true;
  return value >= 0 && (min === "" || value >= Number(min)) && (max === "" || value <= Number(max));
}

function monsterMatches(card: CardInfo, filters: Filters): boolean {
  const monsterOnly = filters.attribute || filters.level || [...filters.atk, ...filters.def].some(Boolean);
  if (!monsterOnly) return true;
  if (kindOf(card.type) !== "monster") return false;
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.level && card.level !== filters.level) return false;
  return inRange(card.atk, filters.atk) && inRange(card.def, filters.def);
}

export function matches(card: CardInfo, filters: Filters): boolean {
  if (!card.name.toLowerCase().includes(filters.name.trim().toLowerCase())) return false;
  if (filters.kind && !kindMatches(card.type, filters.kind)) return false;
  return monsterMatches(card, filters);
}

// Owned cards matching the filters, sorted by name. Cards whose data is not loaded yet are left out.
export function filterCollection(owned: [number, number][], cards: Cards, filters: Filters): [number, number][] {
  return owned
    .filter(([code]) => {
      const card = cards.get(code);
      return card !== undefined && matches(card, filters);
    })
    .sort(([a], [b]) => (cards.get(a)?.name ?? "").localeCompare(cards.get(b)?.name ?? ""));
}

// Codes of the cards owned at least once.
export const ownedCodes = (owned: [number, number][]): ReadonlySet<number> => new Set(owned.filter(([, quantity]) => quantity > 0).map(([code]) => code));

// Cards of a set the player owns, out of its total; the percentage rounds down so that 100 means complete.
export function setProgress(setCards: readonly number[], owned: ReadonlySet<number>): { owned: number; total: number; percent: number } {
  const count = setCards.filter((code) => owned.has(code)).length;
  return { owned: count, total: setCards.length, percent: setCards.length === 0 ? 0 : Math.floor((count * 100) / setCards.length) };
}
