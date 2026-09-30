import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DraftRun } from "../../server/src/protocol.ts";
import { Draft } from "./Draft.tsx";

const card = (code: number) => ({ code, rarity: "common" });
const run: DraftRun = { id: 1, set: "LOB", setName: "Legend of Blue Eyes White Dragon", pool: [card(1), card(2)], main: null, extra: null, wins: 0, losses: 0, status: "drafting", boosters: 0, round: 2, pack: [3, 4, 5, 6, 7, 8, 9].map(card) };
const render = (value: DraftRun | null) => renderToStaticMarkup(<Draft run={value} send={() => {}} go={() => {}} />);

it("montre le booster en cours face visible, la ronde, le sens de passage et les cartes déjà prises", () => {
  const html = render(run);
  for (const text of ["Mode Draft · Legend of Blue Eyes White Dragon", "Ronde 2 sur 6", "Choix 3 sur 9 : gardez une carte", "voisin de droite", "2 cartes prises : 2 monstres · 0 fusion · 0 magie · 0 piège", "Abandonner la session"]) expect(html).toContain(text);
  expect(html.match(/class="draft__carte"/g)).toHaveLength(7);
  expect(render({ ...run, round: 1 })).toContain("voisin de gauche");
});

it("présente le mode, puis se joue comme le Scellé une fois la réserve draftée", () => {
  expect(render(null)).toContain("Six boosters, carte par carte");
  expect(render(null)).toContain("Commencer une session");
  const playing = render({ ...run, status: "playing", pack: [], wins: 1, main: Array<number>(40).fill(1) });
  for (const text of ["Mode Draft", "Duel 2", "le deck d&#x27;un des bots du draft", "Lancer le duel"]) expect(playing).toContain(text);
  const done = render({ ...run, status: "done", pack: [], wins: 3, boosters: 4 });
  expect(done).toContain("Session terminée");
  expect(done).toContain("4 boosters");
});
