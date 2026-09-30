import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Effet } from "./plateau3d/effets.ts";
import type { Reglages } from "./reglages.ts";
import type { Son } from "./son.ts";

// A fresh copy of the modules each time: settings and audio context are module state.
const charger = async (reglages: Partial<Reglages> = {}) => {
  vi.resetModules();
  const contenu: Record<string, string> = { "yugioh.reglages": JSON.stringify(reglages) };
  vi.stubGlobal("localStorage", { getItem: (cle: string) => contenu[cle] ?? null, setItem: () => {} });
  return import("./son.ts");
};

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
// AudioContext stand-in: counts what a sound builds.
const faux = { contextes: 0, oscillateurs: 0, bruits: 0, maitres: [] as number[] };
class FauxContexte {
  currentTime = 0;
  sampleRate = 100;
  state = "suspended";
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  constructor() {
    faux.contextes++;
  }
  createGain() {
    const gain = param();
    const noeud = { gain, connect: vi.fn() };
    faux.maitres.push(0);
    const index = faux.maitres.length - 1;
    Object.defineProperty(gain, "value", { set: (v: number) => (faux.maitres[index] = v), get: () => faux.maitres[index] });
    return noeud;
  }
  createOscillator() {
    faux.oscillateurs++;
    return { type: "", frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createBuffer(_canaux: number, taille: number) {
    return { getChannelData: () => new Float32Array(taille) };
  }
  createBufferSource() {
    faux.bruits++;
    return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createBiquadFilter() {
    return { type: "", frequency: param(), connect: vi.fn() };
  }
}

beforeEach(() => {
  Object.assign(faux, { contextes: 0, oscillateurs: 0, bruits: 0, maitres: [] });
  vi.stubGlobal("AudioContext", FauxContexte);
});
afterEach(() => vi.unstubAllGlobals());

const cle = "0:4:0";
it.each<[Effet, number, Son | undefined]>([
  [{ type: "pioche", joueur: 1, nombre: 2 }, 0, "pioche"],
  [{ type: "invocation", cle, code: 1, genre: "normale" }, 0, "invocation"],
  [{ type: "pose", cle }, 0, "pose"],
  [{ type: "activation", cle, maillon: 1, joueur: 1 }, 0, "activation"],
  [{ type: "attaque", de: cle, joueur: 1 }, 0, "attaque"],
  [{ type: "depart", cle, genre: "destruction" }, 0, "destruction"],
  [{ type: "depart", cle, genre: "bannissement" }, 0, undefined],
  [{ type: "lp", joueur: 0, delta: -500, directe: false }, 0, "degats"],
  [{ type: "lp", joueur: 1, delta: -500, directe: true }, 0, undefined],
  [{ type: "lp", joueur: 0, delta: 300, directe: false }, 0, "gain"],
  [{ type: "phase", phase: 8, joueur: 0 }, 0, undefined],
])("choisit le son de l'effet %j pour le siège %i", async (effet, siege, attendu) => {
  const { sonDe } = await charger();
  expect(sonDe(effet, siege)).toBe(attendu);
});

it("ne crée ni ne joue rien avant un geste de l'utilisateur", async () => {
  const { jouer } = await charger();
  jouer("pioche");
  expect(faux).toMatchObject({ contextes: 0, oscillateurs: 0, bruits: 0 });
});

it("reprend le contexte au premier geste, puis règle le niveau sur le volume", async () => {
  const { jouer, debloquer } = await charger({ volume: 50 });
  debloquer();
  expect(faux.contextes).toBe(1);
  jouer("invocation");
  expect(faux.oscillateurs).toBe(2);
  expect(faux.maitres[0]).toBeCloseTo(0.5 * 0.3);
});

it("joue chaque son, avec du bruit pour ceux qui en ont", async () => {
  const { jouer, debloquer } = await charger({ vitesse: "normale" });
  debloquer();
  for (const son of ["pioche", "invocation", "pose", "activation", "attaque", "degats", "destruction", "gain", "victoire", "defaite", "clic"] as const) jouer(son);
  expect(faux.oscillateurs).toBe(20);
  expect(faux.bruits).toBe(4);
});

it("ne joue rien quand le son est coupé ou le volume à 0", async () => {
  for (const reglage of [{ son: "coupe" }, { volume: 0 }] as const) {
    const { jouer, debloquer } = await charger(reglage);
    debloquer();
    jouer("victoire");
    expect(faux.oscillateurs).toBe(0);
  }
});

it("en vitesse instantanée, ne superpose pas les sons d'un même instant", async () => {
  const { jouer, debloquer } = await charger({ vitesse: "instantanee" });
  debloquer();
  jouer("pose");
  jouer("attaque");
  expect(faux.oscillateurs).toBe(1);
});
