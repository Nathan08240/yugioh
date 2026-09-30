import { OcgAttribute, OcgType } from "@n1xx1/ocgcore-wasm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo, StoryArcView, StoryDuelView } from "../../server/src/protocol.ts";
import { DuelView } from "./cards.ts";
import { arcState, Briefing, currentArc, duelLabel, Story } from "./Story.tsx";
import { Rewards } from "./ui.tsx";

const monster: CardInfo = {
  name: "Machine à Sous",
  alias: 0,
  desc: "",
  type: OcgType.MONSTER | OcgType.NORMAL,
  level: 7,
  attribute: OcgAttribute.DARK,
  race: 1,
  atk: 2000,
  def: 2300,
  strings: [],
  attributeName: "TÉNÈBRES",
  typeLine: "Machine / Normal",
  image: true,
};
const cards = new Map([
  [3797883, monster],
  [511600399, { ...monster, name: "Slifer, le Dragon Céleste", attribute: OcgAttribute.DIVINE }],
]);
const render = (element: ReactElement) => renderToStaticMarkup(<DuelView value={{ cards, show: () => {}, seat: 0 }}>{element}</DuelView>);

const duel = (id: string, status: StoryDuelView["status"], extra: Partial<StoryDuelView> = {}): StoryDuelView => ({
  id,
  title: `Duel ${id}`,
  opponent: "Bandit Keith",
  lp: 4000,
  hand: 5,
  special: [],
  intro: "Un ancien rival réapparaît.",
  rewards: { boosters: 1 },
  requires: [],
  status,
  stars: status === "done" ? 1 : 0,
  ...extra,
});
const arcs: StoryArcView[] = [
  { id: "dk", title: "Le Royaume des Duellistes", duels: [duel("dk-1", "done", { stars: 3 }), duel("dk-2", "done", { stars: 2 })] },
  {
    id: "bc",
    title: "Battle City",
    duels: [
      duel("bc-1", "done", { requires: ["dk"] }),
      duel("bc-2", "available", { requires: ["bc-1"], rewards: { boosters: 2, cards: [3797883] } }),
      duel("bc-3", "locked", { requires: ["bc-2"], rewards: { boosters: 2, cards: [511600399] } }),
    ],
  },
  { id: "noah", title: "Le Monde virtuel de Noah", duels: [duel("noah-1", "locked", { requires: ["bc"] })] },
];

it("suit la progression : arc en cours, état de chaque arc, position d'un duel", () => {
  expect(currentArc(arcs)?.id).toBe("bc");
  expect(arcs.map(arcState)).toEqual(["fini", "encours", "verrou"]);
  expect(duelLabel(arcs, "bc-2")).toBe("Battle City · Duel 2 sur 3");
  expect(duelLabel(arcs, "inconnu")).toBeUndefined();
});

it("montre les arcs et les duels de l'arc en cours, verrouillés, disponibles et gagnés", () => {
  const html = render(<Story arcs={arcs} send={() => {}} />);
  expect(html).toContain('<h1 class="titre">Battle City</h1>');
  expect(html).toContain('<b class="chiffres">3</b> duels gagnés sur 6');
  expect(html).toContain('class="arc arc--fini"');
  expect(html).toMatch(/class="arc arc--verrou"><button type="button" disabled=""/);
  expect(html).toContain('aria-current="true"');
  for (const status of ["done", "available", "locked"]) expect(html).toContain(`etape etape--${status}`);
  expect(html).toContain("Voir le duel");
  expect(html).toContain("Rejouer");
  expect(html).toContain("Gagnez le duel 2 pour le débloquer.");
  // The god of a locked duel stays a mystery, announced as divine.
  expect(html).toContain("Une carte divine + 2 boosters");
  expect(html).not.toContain("Slifer");
  expect(html).toContain("Machine à Sous + 2 boosters");
  // Stars of each duel won and total of each arc.
  expect(html).toContain('aria-label="1 étoile sur 3"');
  expect(html).toMatch(/Étoiles : <\/span>5 \/ 6/);
  expect(html).toMatch(/Étoiles : <\/span>1 \/ 9/);
});

it("présente le duel : adversaire, LP, main, règles spéciales, récompenses", () => {
  const bandit = duel("bc-2", "available", { special: ["battle-city"], rewards: { boosters: 2, cards: [3797883] } });
  const html = render(<Briefing duel={bandit} label="Battle City · Duel 2 sur 3" back={() => {}} start={() => {}} />);
  for (const text of ["Battle City · Duel 2 sur 3", "contre <b>Bandit Keith</b>", "4000 LP", "5 cartes en main", "Règles de Battle City", "3 Sacrifices", "2 boosters", "Machine à Sous", "Lancer le duel"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('<span class="avatar avatar--geant">BK</span>');
  // Difficulty: Normal by default, Facile doubles the player's LP.
  for (const text of ["Difficulté", 'checked="" value="normal"', 'value="facile"', "Le duel tel qu&#x27;il a été écrit."]) expect(html).toContain(text);

  const replay = render(<Briefing duel={{ ...bandit, status: "done", outro: "Keith est libéré." }} back={() => {}} start={() => {}} />);
  for (const text of ["Keith est libéré.", "Récompenses déjà obtenues", "Rejouer le duel"]) expect(replay).toContain(text);
  // What each star asks, with the LP to keep for the 3rd.
  for (const text of ["Gagner le duel", "Gagner en Normal", "Gagner en Normal avec au moins 2000 LP", "1 booster toutes les 3 victoires"]) expect(html).toContain(text);
});

it("met en valeur un Dieu Égyptien gagné", () => {
  const won = render(<Rewards rewards={{ boosters: 2, cards: [511600399, 3797883] }} featured />);
  expect(won).toContain('class="recompense recompense--vedette recompense--divine"');
  expect(won).toContain("Carte divine");
  expect(won).toContain('class="recompense recompense--vedette"><div');
  expect(won).toContain("Carte gagnée");
});
