import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueue, D3, type Sequence } from "./motion.ts";

// A fresh copy of the module each time: the settings are read once per page.
const charger = () => import("./reglages.ts");
const store = (contenu: Record<string, string> = {}) => ({ getItem: (cle: string) => contenu[cle] ?? null, setItem: (cle: string, valeur: string) => void (contenu[cle] = valeur) });

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it("donne les valeurs par défaut sans localStorage", async () => {
  vi.stubGlobal("localStorage", undefined);
  const { reglages, DEFAUTS } = await charger();
  expect(reglages()).toEqual(DEFAUTS);
});

it("donne les valeurs par défaut quand localStorage lève", async () => {
  const leve = () => {
    throw new Error("bloqué");
  };
  vi.stubGlobal("localStorage", { getItem: leve, setItem: leve });
  const { reglages, regler, DEFAUTS } = await charger();
  expect(reglages()).toEqual(DEFAUTS);
  regler({ vitesse: "rapide" });
  expect(reglages().vitesse).toBe("rapide");
});

it("ignore le contenu illisible ou inconnu, réglage par réglage", async () => {
  vi.stubGlobal("localStorage", store({ "yugioh.reglages": '{"vitesse":"rapide","mouvement":"x","qualite":3}' }));
  const { reglages, DEFAUTS } = await charger();
  expect(reglages()).toEqual({ ...DEFAUTS, vitesse: "rapide" });
  vi.resetModules();
  vi.stubGlobal("localStorage", store({ "yugioh.reglages": "pas du json" }));
  expect((await charger()).reglages().vitesse).toBe("normale");
});

it("écrit les réglages et les relit", async () => {
  const contenu: Record<string, string> = {};
  vi.stubGlobal("localStorage", store(contenu));
  const { regler } = await charger();
  regler({ qualite: "basse" });
  regler({ mouvement: "toujours" });
  vi.resetModules();
  const relu = await charger();
  expect(relu.reglages()).toEqual({ ...relu.DEFAUTS, mouvement: "toujours", qualite: "basse" });
});

it("garde le son, les chaînes et le volume, et borne un volume hors de 0-100", async () => {
  vi.stubGlobal("localStorage", store({ "yugioh.reglages": '{"son":"coupe","chaines":"jamais","volume":35}' }));
  expect(await charger().then(({ reglages }) => reglages())).toMatchObject({ son: "coupe", chaines: "jamais", volume: 35 });
  for (const volume of [150, -1, "fort"]) {
    vi.resetModules();
    vi.stubGlobal("localStorage", store({ "yugioh.reglages": JSON.stringify({ volume }) }));
    const { reglages, DEFAUTS } = await charger();
    expect(reglages()).toMatchObject({ son: "actif", chaines: "auto", volume: DEFAUTS.volume });
  }
});

it("le réglage Toujours ou Jamais l'emporte sur le système", async () => {
  vi.stubGlobal("localStorage", store());
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { regler } = await charger();
  const { prefersReduced } = await import("./motion.ts");
  expect(prefersReduced()).toBe(true);
  regler({ mouvement: "jamais" });
  expect(prefersReduced()).toBe(false);
  regler({ mouvement: "toujours" });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  expect(prefersReduced()).toBe(true);
});

// Element.animate stand-in: records the durations it is given.
function element() {
  const options: KeyframeAnimationOptions[] = [];
  const el = {
    animate(_keyframes: Keyframe[], option: KeyframeAnimationOptions) {
      options.push(option);
      return { finished: Promise.resolve(), finish: () => {}, updatePlaybackRate: () => {} };
    },
  };
  return { el: el as unknown as Element, options };
}

it.each([
  [1, D3, 100],
  [2, D3 / 2, 50],
  [Infinity, 0, 0],
])("la vitesse %s divise les durées et les délais de la file", async (vitesse, duree, delai) => {
  const queue = createQueue(() => false, () => vitesse);
  const { el, options } = element();
  const sequence: Sequence = ({ anim }) => anim(el, [{ opacity: 0 }, { opacity: 1 }], { delay: 100 });
  await queue.play(sequence);
  expect(options[0]).toMatchObject({ duration: duree, delay: delai });
});

it("Instantanée supprime aussi les pauses et les tweens", async () => {
  vi.useFakeTimers();
  const queue = createQueue(() => false, () => Infinity);
  const updates: number[] = [];
  await queue.play(async ({ pause, tween }) => {
    await pause(5000, true);
    await tween(900, (k) => updates.push(k));
  });
  expect(updates).toEqual([1]);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
