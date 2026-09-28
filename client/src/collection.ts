import { OcgType } from "@n1xx1/ocgcore-wasm";
import type { CardInfo } from "../../server/src/protocol.ts";
import { has, type Cards } from "./cards.ts";

export type Kind = "" | "monster" | "spell" | "trap";

// Empty fields do not filter. Attribute, level and stats keep monsters only.
export type Filters = { name: string; kind: Kind; attribute: number; level: number; atk: [string, string]; def: [string, string] };

export const noFilters: Filters = { name: "", kind: "", attribute: 0, level: 0, atk: ["", ""], def: ["", ""] };

export function kindOf(type: number): Kind {
  if (has(type, OcgType.SPELL)) return "spell";
  if (has(type, OcgType.TRAP)) return "trap";
  return "monster";
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
  if (filters.kind && kindOf(card.type) !== filters.kind) return false;
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
