// Booster choreographies (design/motion.md): the pack tears open, each card is revealed with an intensity rising with its rarity.
import { D1, D2, D3, D4, ELAN, RESSORT, type Step } from "./motion.ts";

// Elements of the opening screen the choreographies play on.
export type Scene = { layer: HTMLElement; rays: HTMLElement; veil: HTMLElement };
// The revealed card: `outer` trembles and flies to its place, `flip` turns over and glows.
export type Shown = { outer: HTMLElement; flip: HTMLElement; label: HTMLElement; badge?: HTMLElement | null };

const PRISM = ["#ff5a8a", "#ffc53d", "#6dff9e", "#43f0ff", "#8b7dff", "#ff5ad9"];
const GLOWS = new Map([
  ["rare", "0 0 0 2px #dfe6f5, 0 0 22px rgb(223 230 245 / 0.5)"],
  ["super", "0 0 0 2px #43f0ff, 0 0 34px rgb(67 240 255 / 0.6)"],
  ["ultra", "0 0 0 2px #ffe08a, 0 0 60px 10px rgb(255 197 61 / 0.55)"],
  ["secret", "0 0 0 2px #ff7ad9, 0 0 60px 10px rgb(255 122 217 / 0.5), 0 0 120px rgb(67 240 255 / 0.35)"],
]);
const NO_GLOW = "0 0 0 0 transparent";
const turn = (deg: number) => `perspective(900px) rotateY(${deg}deg)`;

// A short-lived decoration of the layer, centred on `box`, absent when motion is reduced or skipped.
function effect(scene: Scene, kind: string, box: DOMRect, size = { w: box.width, h: box.height }): HTMLElement {
  const el = document.createElement("div");
  el.className = `effet effet--${kind}`;
  el.style.cssText = `left:${box.left + box.width / 2 - size.w / 2}px;top:${box.top + box.height / 2 - size.h / 2}px;width:${size.w}px;height:${size.h}px`;
  scene.layer.append(el);
  return el;
}

function flash({ anim, reduced }: Step, scene: Scene, box: DOMRect, color = "rgb(255 255 255 / 0.9)") {
  if (reduced) return;
  const el = effect(scene, "flash", box, { w: box.height * 2.4, h: box.height * 2.4 });
  el.style.setProperty("--f", color);
  anim(el, [{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }]).then(() => el.remove());
}

function shards({ anim, reduced }: Step, scene: Scene, box: DOMRect) {
  if (reduced) return;
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * 2 * Math.PI;
    const distance = 190 * (0.7 + ((i * 0.618) % 1) * 0.6);
    const el = effect(scene, "eclat", box, { w: 9, h: 18 });
    el.style.setProperty("--c", PRISM[i % PRISM.length]);
    const start = `rotate(${angle + Math.PI / 2}rad)`;
    const end = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px) ${start} scale(0.4)`;
    anim(el, [{ opacity: 1, transform: start }, { opacity: 0, transform: end }], { duration: D3 + D2 }).then(() => el.remove());
  }
}

// A decoration that plays once over the card then leaves: silver sweep, holo wave, prism ring.
function sweep({ anim, reduced }: Step, scene: Scene, kind: string, box: DOMRect, keyframes: Keyframe[], size?: { w: number; h: number }) {
  if (reduced) return;
  const el = effect(scene, kind, box, size);
  anim(el, keyframes, { duration: D4 }).then(() => el.remove());
}

// Gold rays, prismatic for a Secret Rare (the class follows the card shown).
const rays = ({ anim }: Step, scene: Scene) => anim(scene.rays, [{ opacity: 0 }, { opacity: 1 }], { duration: D4 });
const glow = ({ anim }: Step, el: Element, rarity: string, duration: number) => anim(el, [{ boxShadow: NO_GLOW }, { boxShadow: GLOWS.get(rarity) ?? NO_GLOW }], { duration });
const tremble = ({ anim }: Step, el: Element, duration: number) =>
  anim(
    el,
    [0, 2, -2, 2, -2, 1, 0].map((x) => ({ translate: `${x}px 0` })),
    { duration, easing: "linear" },
  );
const shine = ({ anim }: Step, el: Element, duration = D4) =>
  anim(el.querySelector(".carte") ?? el, [{ "--reflet-x": "0%", "--reflet-y": "10%" }, { "--reflet-x": "100%", "--reflet-y": "90%" }], { duration });

// The card turns over from its back: squeezed to the edge, then opened on its face.
async function flip({ anim }: Step, el: Element, duration: number) {
  await anim(el, [{ transform: turn(180) }, { transform: turn(90) }], { duration: duration / 2, easing: ELAN });
  await anim(el, [{ transform: turn(90) }, { transform: turn(0) }], { duration: duration / 2 });
}

// 0 the pack arrives, sways, tears, its strip flies off, then it goes down while the pile rises (≈ 2.1 s).
export async function openPack(step: Step, scene: Scene, pack: HTMLElement, pile: HTMLElement) {
  const { anim } = step;
  const tear = pack.querySelector(".dechirure") ?? pack;
  await anim(pack, [{ opacity: 0, transform: "translateY(30px) scale(0.92)" }, { opacity: 1, transform: "none" }]);
  await anim(
    pack,
    ["0deg", "-2.5deg", "2.5deg", "-1.5deg", "0deg"].map((rotate) => ({ rotate })),
    { easing: "ease-in-out" },
  );
  await anim(tear, [{ scale: "0 1" }, { scale: "1 1" }], { duration: D2, easing: ELAN });
  pack.classList.add("paquet--ouvert");
  flash(step, scene, tear.getBoundingClientRect());
  await Promise.all([
    anim(pack.querySelector(".paquet__bande") ?? pack, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(50px, -80px) rotate(24deg)" }], { easing: ELAN }),
    anim(tear, [{ opacity: 1 }, { opacity: 0 }]),
  ]);
  await Promise.all([
    anim(pack, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(45%) scale(0.95)" }], { easing: ELAN }),
    anim(pile, [{ opacity: 0, transform: "translateY(24px) scale(0.9)" }, { opacity: 1, transform: "none" }], { delay: D1 }),
  ]);
}

// The card shown before joins its place in the row, from where it was shown.
export function place({ anim, reduced }: Step, slot: Element, from: DOMRect) {
  if (reduced) return anim(slot, [{ opacity: 0 }, { opacity: 1 }]);
  const to = slot.getBoundingClientRect();
  const k = from.width / (to.width || 1);
  const start = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${k})`;
  return anim(slot, [{ transformOrigin: "0 0", transform: start }, { transformOrigin: "0 0", transform: "none" }]);
}

type Treatment = { before?: (step: Step, scene: Scene, card: Shown) => Promise<unknown>; flip: number; after?: (step: Step, scene: Scene, card: Shown) => unknown };

// Anticipation, turn, then burst: the rarer the card, the longer and brighter (rarity keys of cards.ts).
const TREATMENTS = new Map<string, Treatment>([
  ["commune", { flip: D2 }],
  [
    "rare",
    {
      before: (step, _, { flip }) => glow(step, flip, "rare", D2),
      flip: D2,
      after: (step, scene, { flip }) => sweep(step, scene, "argent", flip.getBoundingClientRect(), [{ backgroundPosition: "120% 0" }, { backgroundPosition: "-20% 0" }]),
    },
  ],
  [
    "super",
    {
      before: (step, _, { flip }) => glow(step, flip, "super", D3),
      flip: D3,
      after: (step, scene, { flip }) => {
        const box = flip.getBoundingClientRect();
        sweep(step, scene, "onde", box, [{ opacity: 1, transform: "scale(0.9)" }, { opacity: 0, transform: "scale(1.5)" }]);
        return shine(step, flip);
      },
    },
  ],
  [
    "ultra",
    {
      before: async (step, scene, { outer, flip }) => {
        await Promise.all([glow(step, flip, "ultra", D3), tremble(step, outer, D3)]);
        await step.pause(D2);
        flash(step, scene, flip.getBoundingClientRect(), "rgb(255 197 61 / 0.85)");
        rays(step, scene);
      },
      flip: D3,
      after: (step, _, { flip }) => shine(step, flip),
    },
  ],
  [
    "ultimate",
    {
      before: async (step, scene, { outer, flip }) => {
        await Promise.all([glow(step, flip, "ultra", D4), tremble(step, outer, D4)]);
        rays(step, scene);
      },
      flip: D4,
      after: (step, _, { flip }) =>
        Promise.all([
          shine(step, flip, D4 + D3),
          step.anim(flip, [{ transform: "perspective(900px) rotateY(-26deg) rotateX(10deg)" }, { transform: "perspective(900px) rotateY(-8deg) rotateX(4deg)" }], { duration: D4 + D3 }),
        ]),
    },
  ],
  [
    "secret",
    {
      before: async (step, scene, { outer, flip }) => {
        await step.anim(scene.veil, [{ opacity: 0 }, { opacity: 1 }]);
        await Promise.all([glow(step, flip, "secret", D4), tremble(step, outer, D4)]);
        await step.pause(D2);
        const box = flip.getBoundingClientRect();
        sweep(step, scene, "prisme", box, [{ opacity: 1, transform: "scale(0.3)" }, { opacity: 0, transform: "scale(3.2)" }], { w: box.height * 1.2, h: box.height * 1.2 });
        shards(step, scene, box);
        flash(step, scene, box, "rgb(255 122 217 / 0.8)");
        rays(step, scene);
      },
      flip: D3,
      after: (step, scene, { flip }) => Promise.all([shine(step, flip), step.anim(scene.veil, [{ opacity: 1 }, { opacity: 0 }])]),
    },
  ],
]);

// The rarities revealed with a burst: rays, springing label.
export const STRONG: ReadonlySet<string> = new Set(["ultra", "ultimate", "secret"]);

// Reveals the card on top of the pile, then its rarity label and, for a card not owned before, the "Nouvelle carte" badge.
export async function revealCard(step: Step, scene: Scene, card: Shown, rarity: string) {
  const treatment = TREATMENTS.get(rarity) ?? { flip: D2 };
  const strong = STRONG.has(rarity);
  await treatment.before?.(step, scene, card);
  await flip(step, card.flip, treatment.flip);
  await treatment.after?.(step, scene, card);
  await step.anim(card.label, [{ opacity: 0, transform: `scale(${strong ? 1.5 : 1.1})` }, { opacity: 1, transform: "none" }], { easing: strong ? RESSORT : undefined });
  if (card.badge) await step.anim(card.badge, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: D2, easing: RESSORT });
}
