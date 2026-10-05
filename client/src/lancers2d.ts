// Dice and coins of the 2D fallback: they tumble in the middle of the board and stop on their result.
import { facePiece } from "./board.ts";
import { D2, D4, SORTIE } from "./motion.ts";
import type { Effet } from "./plateau3d/effets.ts";
import type { Jeu } from "./plateau3d/spectacle.ts";

// Steps of the tumble: a random face at each, the result at the last.
const PAS = 12;

export async function lancer2D(jeu: Jeu, zone: HTMLElement | null, effet: Extract<Effet, { type: "de" | "piece" }>, camp: string) {
  if (!zone) return;
  const faces = effet.type === "de" ? effet.resultats.map(String) : effet.resultats.map(facePiece);
  const hasard = effet.type === "de" ? () => String(1 + Math.floor(Math.random() * 6)) : () => facePiece(Math.random() < 0.5);
  const objets = faces.map(() => Object.assign(document.createElement("span"), { className: `lancer__objet lancer__objet--${effet.type}` }));
  zone.dataset.camp = camp;
  zone.replaceChildren(...objets);
  let pas = -1;
  await Promise.all([
    ...objets.map((objet, i) =>
      jeu.anim(
        objet,
        [
          { opacity: 0, transform: "translateY(-90px) rotate(0deg)" },
          { opacity: 1, transform: `translateY(0) rotate(${360 * (2 + (i % 2))}deg)` },
        ],
        { duration: D4, easing: SORTIE },
      ),
    ),
    jeu.tween(D4, (k) => {
      const courant = Math.min(PAS, Math.floor(k * PAS));
      if (k < 1 && courant === pas) return;
      pas = courant;
      objets.forEach((objet, i) => {
        objet.textContent = k < 1 ? hasard() : faces[i];
      });
    }),
  ]);
  await jeu.pause(900, true);
  await Promise.all(objets.map((objet) => jeu.anim(objet, [{ opacity: 1 }, { opacity: 0 }], { duration: D2 })));
  zone.replaceChildren();
}
