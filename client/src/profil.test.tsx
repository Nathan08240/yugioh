import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo, DeckResult, StoryArcView } from "../../server/src/protocol.ts";
import { DuelView } from "./cards.ts";
import { initialLobby, reduce, type LobbyState } from "./lobby.ts";
import { completion, ProfilView, storyStars } from "./Profil.tsx";
import { Shell } from "./Shell.tsx";
import { Avatar } from "./ui.tsx";

const card = (name: string, image: boolean) => ({ name, image, type: 1, alias: 0, desc: "", level: 4, attribute: 1, race: 1, atk: 1000, def: 1000, strings: [], attributeName: "", typeLine: "" }) satisfies CardInfo;
const cards = new Map([
  [100, card("Magicien Sombre", true)],
  [200, card("Dragon Blanc", false)],
]);
const results: DeckResult[] = [
  { deck: 1, mode: "online", wins: 3, losses: 1 },
  { deck: 1, mode: "bot", level: "debutant", wins: 2, losses: 0 },
  { deck: null, mode: "bot", level: "expert", wins: 0, losses: 2 },
  { deck: 1, mode: "story", level: "normal", wins: 1, losses: 1 },
];
const duel = (stars: number) => ({ stars }) as StoryArcView["duels"][number];
const story = [{ id: "a", title: "A", duels: [duel(3), duel(1), duel(0)] }] as StoryArcView[];
const state: LobbyState = { ...initialLobby, pseudo: "Yugi", collection: [[100, 1], [200, 2]], results, story, profile: { avatar: 100, favorite: 200 } };

const render = (view: LobbyState, sets?: number[][]) =>
  renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <ProfilView state={view} sets={sets} send={() => {}} />
    </DuelView>,
  );

it("compte les étoiles de l'histoire sur 3 par duel, et la part du pool possédée", () => {
  expect(storyStars(story)).toEqual({ stars: 4, max: 9 });
  expect(completion([[100, 300], [200, 300]], [[100, 1], [200, 0], [999, 1]])).toEqual({ owned: 1, total: 3, percent: 33 });
});

it("affiche le bilan total et par mode, avec le bot par niveau", () => {
  const html = render(state, [[100, 200, 300, 400]]);
  for (const text of ["Yugi", "Bot débutant", "Bot normal", "Bot expert", "En ligne", "Histoire"]) expect(html).toContain(text);
  expect(html).toContain("<td class=\"chiffres\">6</td><td class=\"chiffres\">4</td><td class=\"chiffres\">60 %</td>");
  expect(html).toMatch(/Bot débutant<\/th><td class="chiffres">2<\/td><td class="chiffres">0<\/td><td class="chiffres">100 %/);
  expect(html).toMatch(/Bot normal<\/th><td class="chiffres">0<\/td><td class="chiffres">0<\/td><td class="chiffres">—/);
  expect(html).toContain("4 / 9");
  expect(html).toContain("50 %");
  expect(html).toContain("2 cartes sur 4");
});

it("montre l'illustration de l'avatar et la carte favorite, sinon l'initiale et une invitation", () => {
  const html = render(state);
  expect(html).toContain('src="/api/art/100.jpg"');
  expect(html).toContain("Dragon Blanc");
  const bare = render({ ...state, profile: { avatar: null, favorite: null }, collection: undefined, results: undefined });
  expect(bare).toContain(">Y</span>");
  expect(bare).toContain("Aucune carte favorite choisie");
  expect(bare).toContain("Chargement des statistiques");
});

it("un avatar sans illustration disponible retombe sur l'initiale", () => {
  const html = renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <Avatar name="Yugi" code={200} />
    </DuelView>,
  );
  expect(html).toContain(">Y</span>");
  expect(html).not.toContain("<img");
});

it("garde le profil reçu du serveur et l'avatar de l'adversaire", () => {
  const next = reduce(initialLobby, { type: "player_profile", avatar: 5, favorite: null });
  expect(next.profile).toEqual({ avatar: 5, favorite: null });
  const joined = reduce(initialLobby, { type: "joined", room: "ABCDE", seat: 0, lp: 8000, decks: [40, 40], extras: [0, 0], opponent: "Kaiba", opponentAvatar: 7, log: [] });
  expect(joined.opponentAvatar).toBe(7);
});

it("ajoute Profil au menu principal", () => {
  const html = renderToStaticMarkup(<Shell id="x" pseudo="Yugi" page="accueil" go={() => {}}>{null}</Shell>);
  expect(html).toMatch(/Règles[^]*Profil[^]*Paramètres/);
});
