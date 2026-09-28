import { OcgPhase, OcgType } from "@n1xx1/ocgcore-wasm";
import { createContext, useContext, useEffect, useState } from "react";
import type { CardInfo } from "../../server/src/protocol.ts";

export type Cards = ReadonlyMap<number, CardInfo>;
// EDOPro system strings by id, in French.
export type Strings = ReadonlyMap<number, string>;

// Card data of the pool, the card to show in the detail panel and the player's seat.
export const DuelView = createContext<{ cards: Cards; show: (code: number) => void; seat: number }>({ cards: new Map(), show: () => {}, seat: 0 });
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

export function frame(type: number): string {
  if (has(type, OcgType.TRAP)) return "trap";
  if (has(type, OcgType.SPELL)) return "spell";
  if (has(type, OcgType.TOKEN)) return "token";
  if (has(type, OcgType.FUSION)) return "fusion";
  if (has(type, OcgType.RITUAL)) return "ritual";
  if (has(type, OcgType.EFFECT)) return "effect";
  return "normal";
}

// -2 in BabelCDB is a "?" stat.
export const stat = (value: number) => (value === -2 ? "?" : String(value));

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
