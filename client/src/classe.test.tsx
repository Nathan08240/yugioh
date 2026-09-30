import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { DuelView } from "./cards.ts";
import { ClasseView } from "./Classe.tsx";
import { initialLobby, type LobbyState } from "./lobby.ts";

const cards = new Map([[100, { name: "Magicien Sombre", image: true, type: 1, alias: 0, desc: "", level: 7, attribute: 1, race: 1, atk: 2500, def: 2100, strings: [], attributeName: "", typeLine: "" } satisfies CardInfo]]);
const ranked = { rating: 1016, games: 1, leaderboard: [{ pseudo: "Kaiba", avatar: 100, rating: 1200, games: 5 }, { pseudo: "Yugi", avatar: null, rating: 1016, games: 1 }] };
const render = (state: LobbyState, now = 0) =>
  renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <ClasseView state={{ ...initialLobby, pseudo: "Yugi", ...state }} send={() => {}} now={now} go={() => {}} />
    </DuelView>,
  );

it("affiche le classement du joueur, ses parties et les meilleurs joueurs avec leur avatar", () => {
  const html = render({ ...initialLobby, ranked });
  for (const text of ["Classement <span class=\"chiffres\">1016</span>", "1 partie ·", "Chercher un adversaire", "Kaiba", "/api/art/100.jpg", "1200", "Meilleurs joueurs"]) expect(html).toContain(text);
  expect(html).toContain('<tr aria-current="true"><td class="chiffres">2</td>');
  expect(html).not.toContain("Annuler");
});

it("pendant la recherche, affiche le temps d'attente et le bouton Annuler", () => {
  const html = render({ ...initialLobby, ranked, rankedSince: 1000 }, 66_000);
  expect(html).toContain("Recherche d&#x27;un adversaire… <b class=\"chiffres\">1:05</b>");
  expect(html).toContain("Annuler");
  expect(html).not.toContain("Chercher un adversaire");
});

it("signale un classement vide", () => {
  expect(render({ ...initialLobby, ranked: { rating: 1000, games: 0, leaderboard: [] } })).toContain("Aucun duel classé joué pour l&#x27;instant.");
});

it("rappelle sur l'écran classé que le deck actif dépasse la liste Goat", () => {
  const goatCards = new Map([...cards, [12580477, { ...cards.get(100) as CardInfo, name: "Raigeki" }]]);
  const decks = { type: "decks" as const, decks: [{ id: 1, name: "Yugi", main: [12580477], extra: [] }], active: 1 };
  const html = renderToStaticMarkup(
    <DuelView value={{ cards: goatCards, show: () => {}, seat: 0 }}>
      <ClasseView state={{ ...initialLobby, pseudo: "Yugi", ranked, decks }} send={() => {}} now={0} go={() => {}} />
    </DuelView>,
  );
  expect(html).toContain("Votre deck actif a 1 carte au-delà de la liste Goat, qui s&#x27;applique en classé.");
  expect(render({ ...initialLobby, ranked })).not.toContain("liste Goat");
});
