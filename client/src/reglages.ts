// Player settings kept in the browser (localStorage); other features add their options here.
import { useSyncExternalStore } from "react";
import type { Qualite } from "./plateau3d/monde.ts";

export type Vitesse = "normale" | "rapide" | "instantanee";
export type Mouvement = "auto" | "toujours" | "jamais";
export type Son = "actif" | "coupe";
// Auto asks to chain only when a card can answer; Jamais passes every optional chain prompt.
export type Chaines = "auto" | "jamais";
// `volume`: 0 to 100.
export type Reglages = { vitesse: Vitesse; mouvement: Mouvement; qualite: Qualite; son: Son; chaines: Chaines; emotes: "oui" | "non"; notifications: "oui" | "non"; volume: number };
// The settings picked among a few values (the volume is a number).
export type Choisi = Exclude<keyof Reglages, "volume">;

export const DEFAUTS: Reglages = { vitesse: "normale", mouvement: "auto", qualite: "haute", son: "actif", chaines: "auto", emotes: "oui", notifications: "non", volume: 60 };
const VALEURS: { [K in Choisi]: readonly Reglages[K][] } = {
  vitesse: ["normale", "rapide", "instantanee"],
  mouvement: ["auto", "toujours", "jamais"],
  qualite: ["haute", "basse"],
  son: ["actif", "coupe"],
  chaines: ["auto", "jamais"],
  emotes: ["oui", "non"],
  notifications: ["oui", "non"],
};
// Divisor of the animation durations; Infinity plays everything at once.
export const FACTEUR: Record<Vitesse, number> = { normale: 1, rapide: 2, instantanee: Infinity };

const CLE = "yugioh.reglages";

const valide = <K extends Choisi>(cle: K, valeur: unknown): Reglages[K] => (VALEURS[cle].includes(valeur as Reglages[K]) ? (valeur as Reglages[K]) : DEFAUTS[cle]);

const volume = (valeur: unknown) => (typeof valeur === "number" && valeur >= 0 && valeur <= 100 ? Math.round(valeur) : DEFAUTS.volume);

// Stored settings, each one checked: anything missing or unknown falls back to its default.
export function lire(): Reglages {
  let brut: unknown;
  try {
    brut = JSON.parse(globalThis.localStorage.getItem(CLE) ?? "null");
  } catch {
    brut = null;
  }
  const saisi = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  return {
    vitesse: valide("vitesse", saisi.vitesse),
    mouvement: valide("mouvement", saisi.mouvement),
    qualite: valide("qualite", saisi.qualite),
    son: valide("son", saisi.son),
    chaines: valide("chaines", saisi.chaines),
    emotes: valide("emotes", saisi.emotes),
    notifications: valide("notifications", saisi.notifications),
    volume: volume(saisi.volume),
  };
}

// The stylesheets follow the choice too: "reduit" forces reduced motion, "libre" lifts the system one.
const MARQUE: Record<Mouvement, string | undefined> = { auto: undefined, toujours: "reduit", jamais: "libre" };
function marquer({ mouvement }: Reglages) {
  const racine = globalThis.document?.documentElement;
  if (!racine) return;
  const marque = MARQUE[mouvement];
  if (marque) racine.dataset.mouvement = marque;
  else delete racine.dataset.mouvement;
}

let courant: Reglages | undefined;
const abonnes = new Set<() => void>();

export function reglages(): Reglages {
  if (!courant) {
    courant = lire();
    marquer(courant);
  }
  return courant;
}

export function regler(changement: Partial<Reglages>) {
  courant = { ...reglages(), ...changement };
  try {
    globalThis.localStorage.setItem(CLE, JSON.stringify(courant));
  } catch {
    // Storage unavailable: the choice lasts until the page closes.
  }
  marquer(courant);
  for (const abonne of abonnes) abonne();
}

const abonner = (rappel: () => void) => {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
};

export const useReglages = () => [useSyncExternalStore(abonner, reglages, reglages), regler] as const;

// Applies the stored choice to the page at startup.
reglages();
