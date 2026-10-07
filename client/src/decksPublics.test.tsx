import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo, PublicDeck, SharedDeck } from "../../server/src/protocol.ts";
import { DuelView } from "./cards.ts";
import { DecksPublics } from "./DecksPublics.tsx";
import { deckFromUrl, deckLink, initialLobby, reduce, type LobbyState } from "./lobby.ts";

const carte = (name: string): CardInfo => ({ name, alias: 0, desc: "", type: 0x11, level: 4, attribute: 0, race: 0, atk: 0, def: 0, strings: [], attributeName: "", typeLine: "", image: false });
const cards = new Map([
  [1, carte("Carte une")],
  [2, carte("Carte deux")],
]);

const base = { code: "ABCD2345", name: "Goat <b>sage</b>", description: "Texte\n<script>x</script>", author: "Yugi", date: "2026-10-09T10:00:00.000Z", copies: 3, goat: true, mine: false };
const listed: PublicDeck = { ...base, main: 40, extra: 0 };
const shared: SharedDeck = { ...base, public: true, main: [1, 1, 2], extra: [], missing: [[1, 1]] };

const render = (state: LobbyState) =>
  renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <DecksPublics state={state} send={() => {}} close={() => {}} />
    </DuelView>,
  );

it("lit le code d'un lien de partage et refuse les codes mal formés", () => {
  expect(deckFromUrl("https://site.fr/?deck=abcd2345")).toBe("ABCD2345");
  expect(deckFromUrl("https://site.fr/?deck=ABCD234")).toBeUndefined();
  expect(deckFromUrl("https://site.fr/?deck=ABCD2340")).toBeUndefined();
  expect(deckFromUrl("https://site.fr/")).toBeUndefined();
  expect(deckFromUrl(deckLink("https://site.fr", "K7M2P9QX"))).toBe("K7M2P9QX");
});

it("garde dans l'état la liste publique, le deck lu, la copie et le code donné, et retire un deck retiré", () => {
  let state = reduce(initialLobby, { type: "public_decks", decks: [listed, { ...listed, code: "ZZZZ9999" }] });
  state = reduce(state, { type: "shared_deck", deck: shared });
  state = reduce(state, { type: "deck_copied", id: 4, name: "Goat", missing: [[1, 1]] });
  state = reduce(state, { type: "deck_shared", code: "ABCD2345", published: false });
  expect(state).toMatchObject({ sharedDeck: shared, deckCopied: { id: 4, name: "Goat" }, deckCode: { code: "ABCD2345", published: false } });
  state = reduce(state, { type: "public_deck_removed", code: "ABCD2345" });
  expect(state.publicDecks?.map((deck) => deck.code)).toEqual(["ZZZZ9999"]);
  expect(state.sharedDeck).toBeUndefined();
  expect(reduce(state, { type: "deck_code_closed" }).deckCode).toBeUndefined();
});

it("affiche le texte des joueurs sans le lire comme du HTML, avec auteur, copies et format", () => {
  const html = render({ ...initialLobby, publicDecks: [listed] });
  expect(html).toContain("Goat &lt;b&gt;sage&lt;/b&gt;");
  expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  for (const texte of ["par Yugi", "3 copies", "40 cartes", "Conforme Goat", "Voir le deck"]) expect(html).toContain(texte);
});

it("propose de retirer le deck à son auteur et à l'admin seulement", () => {
  expect(render({ ...initialLobby, publicDecks: [listed] })).not.toContain("Retirer");
  expect(render({ ...initialLobby, publicDecks: [{ ...listed, mine: true }] })).toContain("Retirer");
  expect(render({ ...initialLobby, admin: true, publicDecks: [listed] })).toContain("Retirer");
});

it("montre au lecteur les cartes qu'il possède et celles qui lui manquent, et ce que la copie a laissé", () => {
  const html = render({ ...initialLobby, sharedDeck: shared, deckCopied: { id: 4, name: "Goat sage", missing: [[1, 1]] } });
  for (const texte of ["Vous possédez 2 cartes sur 3 : il vous en manque 1.", "manque ×1", "Copier dans mes decks", "Deck copié sous le nom", "Carte une ×1"]) expect(html).toContain(texte);
});
