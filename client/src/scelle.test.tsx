import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SealedRun } from "../../server/src/protocol.ts";
import { Scelle } from "./Scelle.tsx";

const run: SealedRun = { id: 1, set: "LOB", setName: "Legend of Blue Eyes White Dragon", pool: [], main: null, extra: null, wins: 3, losses: 1, status: "done", boosters: 4 };
const render = (value: SealedRun | null) => renderToStaticMarkup(<Scelle run={value} send={() => {}} go={() => {}} />);

it("présente le mode avant la première session, puis le bilan d'une session finie ou abandonnée", () => {
  expect(render(null)).toContain("Commencer une session");
  expect(render(null)).toContain("3 victoires : 4 boosters");
  const done = render(run);
  for (const text of ["Session terminée", "3 victoires sur 3 · 1 défaite sur 2", "4 boosters", "Nouvelle session", "Ouvrir mes boosters"]) expect(done).toContain(text);
  const left = render({ ...run, status: "abandoned", wins: 1, boosters: 0 });
  expect(left).toContain("Session abandonnée");
  expect(left).toContain("Aucun booster gagné.");
  expect(left).not.toContain("Ouvrir mes boosters");
});

it("propose le duel suivant entre deux duels", () => {
  const html = render({ ...run, status: "playing", wins: 1, losses: 0, main: Array<number>(40).fill(1), boosters: 0 });
  expect(html).toContain("Duel 2");
  expect(html).toContain("deck de 40 cartes");
  expect(html).toContain("Lancer le duel");
  expect(html).toContain("Abandonner la session");
});
