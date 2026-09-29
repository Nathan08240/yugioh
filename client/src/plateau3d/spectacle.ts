import type { Message } from "../board.ts";
import { sequences, type Queue, type Step } from "../motion.ts";
import type { Effet, Etape } from "./effets.ts";

// A step of the motion queue, with the decorative holds (hologram, banner) cut short once a question waits.
export type Jeu = Step & { tenir: (ms: number) => Promise<void> };
// The 3D scene and the HUD each play the part of an effect they know; the 2D fallback has no scene.
export type Regie = { scene?: (effet: Effet, jeu: Jeu) => Promise<void>; hud?: (effet: Effet, jeu: Jeu) => Promise<void> };

// Queues the steps: the board shown takes each message when its animation reaches it, `fin` runs after the last one.
export function jouer(steps: readonly Etape[], appliquer: (messages: Message[]) => void, regie: Regie, attend: () => boolean, fin: () => void, queue: Queue = sequences): Promise<void> {
  let last = Promise.resolve();
  const all = steps.length > 0 ? steps : [{ prelude: [], avant: [], apres: [] }];
  for (const [i, step] of all.entries()) {
    last = queue.play(async (motion) => {
      const jeu: Jeu = { ...motion, tenir: (ms) => (attend() ? Promise.resolve() : motion.pause(ms)) };
      const play = async (effets: Effet[]) => {
        for (const effet of effets) await Promise.all([regie.scene?.(effet, jeu), regie.hud?.(effet, jeu)]);
      };
      try {
        if (step.prelude.length > 0) appliquer(step.prelude);
        await play(step.avant);
        if (step.message) appliquer([step.message]);
        await play(step.apres);
      } finally {
        if (i === all.length - 1) fin();
      }
    });
  }
  return last;
}
