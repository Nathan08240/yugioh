import { OcgAttribute, OcgPhase, OcgType } from "@n1xx1/ocgcore-wasm";
import { createContext, useContext, useEffect, useState } from "react";
import type { CardInfo } from "../../server/src/protocol.ts";

export type Cards = ReadonlyMap<number, CardInfo>;

// Card data of the pool, the card to show in the detail panel and the player's seat.
export const DuelView = createContext<{ cards: Cards; show: (code: number) => void; seat: number }>({ cards: new Map(), show: () => {}, seat: 0 });
export const useDuelView = () => useContext(DuelView);

export function useCards(): Cards {
  const [cards, setCards] = useState<Cards>(new Map());
  useEffect(() => {
    fetch("/api/cards")
      .then((res) => res.json())
      .then((data: Record<string, CardInfo>) => setCards(new Map(Object.entries(data).map(([code, info]) => [Number(code), info]))))
      .catch((error: unknown) => console.error(error));
  }, []);
  return cards;
}

export const cardName = (cards: Cards, code: number) => (code ? (cards.get(code)?.name ?? `Carte ${code}`) : "carte face cachée");

// An effect description is Stringid(code, index): code << 20 | index, the index-th string of that card.
// ponytail: EDOPro's system strings (code 0) are not vendored, those get a generic label.
export function effectText(cards: Cards, description: string): string | undefined {
  const value = BigInt(description);
  return cards.get(Number(value >> 20n))?.strings[Number(value & 0xfffffn)] || undefined;
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

export const ATTRIBUTES = new Map<number, string>([
  [OcgAttribute.EARTH, "TERRE"],
  [OcgAttribute.WATER, "EAU"],
  [OcgAttribute.FIRE, "FEU"],
  [OcgAttribute.WIND, "VENT"],
  [OcgAttribute.LIGHT, "LUMIÈRE"],
  [OcgAttribute.DARK, "TÉNÈBRES"],
  [OcgAttribute.DIVINE, "DIVIN"],
]);
export const attributeName = (attribute: number) => ATTRIBUTES.get(attribute) ?? "";

// Race bits in engine order, the classic ones only.
const RACES = [
  "Guerrier", "Magicien", "Elfe", "Démon", "Zombie", "Machine", "Aqua", "Pyro", "Rocher", "Bête Ailée", "Plante", "Insecte",
  "Tonnerre", "Dragon", "Bête", "Bête-Guerrier", "Dinosaure", "Poisson", "Serpent de Mer", "Reptile", "Psychique", "Bête Divine",
  "Dieu Créateur",
];

const SUBTYPES: [number, string][] = [
  [OcgType.NORMAL, "Normal"],
  [OcgType.EFFECT, "Effet"],
  [OcgType.FUSION, "Fusion"],
  [OcgType.RITUAL, "Rituel"],
  [OcgType.SPIRIT, "Spirit"],
  [OcgType.UNION, "Union"],
  [OcgType.TOON, "Toon"],
  [OcgType.FLIP, "Flip"],
  [OcgType.TOKEN, "Jeton"],
  [OcgType.QUICKPLAY, "Jeu-Rapide"],
  [OcgType.CONTINUOUS, "Continue"],
  [OcgType.EQUIP, "Équipement"],
  [OcgType.FIELD, "Terrain"],
  [OcgType.COUNTER, "Contre"],
];

// "Dragon / Effet", "Magie Jeu-Rapide", "Piège Contre".
export function typeLine(card: CardInfo): string {
  const subtypes = SUBTYPES.filter(([flag]) => has(card.type, flag)).map(([, label]) => label);
  if (has(card.type, OcgType.SPELL)) return ["Magie", ...subtypes].join(" ");
  if (has(card.type, OcgType.TRAP)) return ["Piège", ...subtypes].join(" ");
  const race = RACES.filter((_, bit) => has(card.race, 1 << bit)).join(" ");
  return [race, ...subtypes].join(" / ");
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
