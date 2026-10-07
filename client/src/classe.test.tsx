import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { DuelView } from "./cards.ts";
import { ClasseView, ofSeason } from "./Classe.tsx";
import { initialLobby, type LobbyState } from "./lobby.ts";

const cards = new Map([[100, { name: "Magicien Sombre", image: true, type: 1, alias: 0, desc: "", level: 7, attribute: 1, race: 1, atk: 2500, def: 2100, strings: [], attributeName: "", typeLine: "" } satisfies CardInfo]]);
const ranked = {
  rating: 1016,
  games: 12,
  season: "2026-10",
  daysLeft: 19,
  seasonGames: 1,
  leaderboard: [{ pseudo: "Kaiba", avatar: 100, rating: 1200, games: 5 }, { pseudo: "Yugi", avatar: null, rating: 1016, games: 1 }],
  previousSeason: "2026-09",
  previousLeaderboard: [{ pseudo: "Pegasus", avatar: null, rating: 1480, games: 30 }],
  lastResult: { season: "2026-08", rating: 1250, games: 11, boosters: 3 },
};
const render = (state: LobbyState, now = 0) =>
  renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <ClasseView state={{ ...initialLobby, pseudo: "Yugi", ...state }} send={() => {}} now={now} go={() => {}} />
    </DuelView>,
  );

it("affiche le classement du joueur, ses parties et les meilleurs joueurs avec leur avatar", () => {
  const html = render({ ...initialLobby, ranked });
  for (const text of ["Classement <span class=\"chiffres\">1016</span>", "12 parties ·", "Chercher un adversaire", "Kaiba", "/api/art/100-160.webp", "1200", "Meilleurs joueurs de la saison"]) expect(html).toContain(text);
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
  const html = render({ ...initialLobby, ranked: { ...ranked, games: 0, seasonGames: 0, leaderboard: [], previousLeaderboard: [], lastResult: null } });
  expect(html).toContain("Aucun duel classé joué cette saison pour l&#x27;instant.");
  expect(html).toContain("encore 5 duels pour la récompense");
  expect(html).not.toContain("Saison de septembre 2026");
  expect(html).not.toContain("classement final <b");
});

it("affiche la saison en cours, ses jours restants, le barème, le dernier résultat du joueur et les meilleurs de la saison précédente", () => {
  const html = render({ ...initialLobby, ranked });
  for (const text of [
    "Saison d&#x27;octobre 2026",
    "19 jours restants · 1 duel cette saison · encore 4 duels pour la récompense",
    "1400 et plus : <b class=\"chiffres\">5 boosters</b>",
    "1200 à 1399 : <b class=\"chiffres\">3 boosters</b>",
    "1000 à 1199 : <b class=\"chiffres\">1 booster</b>",
    "Saison d&#x27;août 2026 : classement final <b class=\"chiffres\">1250</b> en 11 duels, 3 boosters reçus.",
    "Saison de septembre 2026 : les meilleurs",
    "Pegasus",
  ])
    expect(html).toContain(text);
  const done = render({ ...initialLobby, ranked: { ...ranked, daysLeft: 1, seasonGames: 5, lastResult: { season: "2026-09", rating: 900, games: 5, boosters: 0 } } });
  expect(done).toContain("1 jour restant · 5 duels cette saison · récompense assurée selon votre classement final");
  expect(done).toContain("en 5 duels, aucune récompense.");
});

it("nomme la saison avec l'élision devant une voyelle", () => {
  expect(["2026-01", "2026-04", "2026-08", "2026-10", "2026-12"].map(ofSeason)).toEqual(["de janvier 2026", "d'avril 2026", "d'août 2026", "d'octobre 2026", "de décembre 2026"]);
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
