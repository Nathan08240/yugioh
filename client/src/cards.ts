import { OcgAttribute, OcgPhase, OcgType } from "@n1xx1/ocgcore-wasm";
import { createContext, useContext, useEffect, useState } from "react";
import type { CardInfo } from "../../server/src/protocol.ts";

export type Cards = ReadonlyMap<number, CardInfo>;
// EDOPro system strings by id, in French.
export type Strings = ReadonlyMap<number, string>;

// Card data of the pool, the card to show in the detail panel (with its board place, for its current stats) and the player's seat.
// `moi`: for a spectator, the name of the seat shown as "me", who is not "Vous".
// `ouvrir`: opens the detail of a card full screen, on a phone (DeckBuilder.tsx).
export const DuelView = createContext<{ cards: Cards; show: (code: number, place?: string) => void; seat: number; moi?: string; ouvrir?: (code: number) => void }>({ cards: new Map(), show: () => {}, seat: 0 });
export const useDuelView = () => useContext(DuelView);

// A JSON object of the server keyed by number, empty until loaded.
function useNumberMap<T>(url: string): ReadonlyMap<number, T> {
  const [map, setMap] = useState<ReadonlyMap<number, T>>(new Map());
  useEffect(() => {
    fetch(url)
      .then((res) => res.json())
      .then((data: Record<string, T>) => setMap(new Map(Object.entries(data).map(([key, value]) => [Number(key), value]))))
      .catch((error: unknown) => console.error(error));
  }, [url]);
  return map;
}

export const useCards = (): Cards => useNumberMap<CardInfo>("/api/cards");
export const useSystemStrings = (): Strings => useNumberMap<string>("/api/strings");

export const cardName = (cards: Cards, code: number) => (code ? (cards.get(code)?.name ?? `Carte ${code}`) : "carte face cachée");

// An effect description is Stringid(code, index): code << 20 | index, the index-th string of that card, or system string `index` for code 0.
export function effectText(cards: Cards, strings: Strings, description: string): string | undefined {
  const value = BigInt(description);
  const code = Number(value >> 20n);
  const index = Number(value & 0xfffffn);
  return (code ? cards.get(code)?.strings[index] : strings.get(index)) || undefined;
}

export const has = (mask: number, flag: number) => (mask & flag) !== 0;

// Sprite of the house icons (public/icons.svg): `${ICONS}#attr-feu`.
export const ICONS = `${import.meta.env.BASE_URL}icons.svg`;

// Frame of the card (cartes.css t-* classes).
export function frame(type: number): string {
  if (has(type, OcgType.TRAP)) return "piege";
  if (has(type, OcgType.SPELL)) return "magie";
  if (has(type, OcgType.TOKEN)) return "jeton";
  if (has(type, OcgType.FUSION)) return "fusion";
  if (has(type, OcgType.RITUAL)) return "rituel";
  if (has(type, OcgType.EFFECT)) return "effet";
  return "normal";
}

// Attribute of a monster (cartes.css a-* classes, icons.svg attr-* icons).
const ATTRIBUTES = new Map<number, string>([
  [OcgAttribute.EARTH, "terre"],
  [OcgAttribute.WATER, "eau"],
  [OcgAttribute.FIRE, "feu"],
  [OcgAttribute.WIND, "vent"],
  [OcgAttribute.LIGHT, "lumiere"],
  [OcgAttribute.DARK, "tenebres"],
  [OcgAttribute.DIVINE, "divin"],
]);
export const attributeKey = (attribute: number) => ATTRIBUTES.get(attribute);
// The Egyptian Gods, and every other DIVINE monster.
export const isDivine = (cards: Cards, code: number) => cards.get(code)?.attribute === OcgAttribute.DIVINE;

// Printing rarities of the server (server/src/pool.ts): their treatment (r-* and rarete--* classes) and their name.
const RARITIES = new Map<string, [string, string]>([
  ["common", ["commune", "Commune"]],
  ["shortprint", ["commune", "Peu commune"]],
  ["rare", ["rare", "Rare"]],
  ["super", ["super", "Super Rare"]],
  ["ultra", ["ultra", "Ultra Rare"]],
  ["ultimate", ["ultimate", "Ultimate Rare"]],
  ["secret", ["secret", "Secret Rare"]],
  // Copies obtained before the server kept rarities.
  ["", ["commune", "Rareté inconnue"]],
]);
export const rarityKey = (rarity: string) => RARITIES.get(rarity)?.[0] ?? "commune";
export const rarityLabel = (rarity: string) => RARITIES.get(rarity)?.[1] ?? rarity;

// -2 in BabelCDB is a "?" stat.
export const stat = (value: number) => (value === -2 ? "?" : String(value));

// A current ATK or DEF above or below the printed one ("?" is never compared).
export function statChange(current: number, printed: number): "hausse" | "baisse" | undefined {
  if (printed < 0 || current === printed) return undefined;
  return current > printed ? "hausse" : "baisse";
}

// The `count` strongest monsters of a deck, by ATK then level, each one once: the cards a deck is shown with.
export function strongest(codes: readonly number[], cards: Cards, count: number): number[] {
  const power = (code: number) => {
    const card = cards.get(code);
    return card ? card.atk * 100 + card.level : -1;
  };
  return [...new Set(codes)]
    .filter((code) => has(cards.get(code)?.type ?? 0, OcgType.MONSTER))
    .sort((a, b) => power(b) - power(a))
    .slice(0, count);
}

const PHASES = new Map<number, string>([
  [OcgPhase.DRAW, "Draw Phase"],
  [OcgPhase.STANDBY, "Standby Phase"],
  [OcgPhase.MAIN1, "Main Phase 1"],
  [OcgPhase.BATTLE_START, "Battle Phase"],
  [OcgPhase.BATTLE_STEP, "Battle Phase"],
  [OcgPhase.DAMAGE, "Damage Step"],
  [OcgPhase.DAMAGE_CAL, "Damage Step"],
  [OcgPhase.BATTLE, "Battle Phase"],
  [OcgPhase.MAIN2, "Main Phase 2"],
  [OcgPhase.END, "End Phase"],
]);
export const phaseName = (phase: number) => PHASES.get(phase) ?? "";
