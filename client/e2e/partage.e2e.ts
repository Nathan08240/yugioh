import { expect, test } from "@playwright/test";
import type { Deck, PublicDeck, SharedDeck } from "../../server/src/protocol.ts";
import { aller, cartesFactices, lancer } from "./harnais.ts";

const CARTES = cartesFactices(14);
const CODES = Object.keys(CARTES).map(Number);
const MAIN = CODES.slice(0, 13).flatMap((code) => [code, code, code]);
const deck: Deck = { id: 1, name: "Deck de test", main: MAIN, extra: [] };

const info = { code: "ABCD2345", name: "Goat sage", description: "Un deck sans carte interdite", author: "Kaiba", date: "2026-10-09T10:00:00.000Z", copies: 3, goat: true, mine: false };
const partage: SharedDeck = { ...info, public: true, main: MAIN, extra: [], missing: [[CODES[0], 2]] };
const publie: PublicDeck = { ...info, main: 39, extra: 0 };

test("un lien de partage ouvre le deck en lecture avec les cartes manquantes, et la copie part au serveur", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { cartes: CARTES });
  // The link opens the game again: the fake server answers on the new connection.
  await page.goto("/?deck=ABCD2345");
  await expect.poll(() => envoyes.find((msg) => msg.type === "deck_view")).toEqual({ type: "deck_view", code: "ABCD2345" });
  envoyer({ type: "shared_deck", deck: partage });

  await expect(page.getByRole("heading", { name: "Decks publics" })).toBeVisible();
  const lu = page.getByRole("region", { name: "Deck Goat sage" });
  await expect(lu.getByText("Vous possédez 37 cartes sur 39 : il vous en manque 2.")).toBeVisible();
  await expect(lu.getByText("manque ×2")).toBeVisible();
  await expect(lu.getByText("Un deck sans carte interdite")).toBeVisible();
  // The code leaves the address bar once read.
  await expect(page).toHaveURL(/\/$/);

  await lu.getByRole("button", { name: "Copier dans mes decks" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "deck_copy")).toEqual({ type: "deck_copy", code: "ABCD2345" });
  envoyer({ type: "deck_copied", id: 5, name: "Goat sage", missing: [[CODES[0], 2]] });
  await expect(lu.getByText("Deck copié sous le nom « Goat sage ».")).toBeVisible();
  await expect(lu.getByText("Carte factice 0001 ×2")).toBeVisible();
  await expect.poll(() => envoyes.filter((msg) => msg.type === "decks").length).toBeGreaterThan(0);
});

test("le deck builder partage le deck enregistré et le publie, le code s'affiche avec son lien", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { cartes: CARTES });
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  envoyer({ type: "collection", cards: CODES.map((code) => [code, 3]), rarities: [], points: 0 });
  envoyer({ type: "decks", decks: [deck], active: 1 });
  await aller(page, "Collection et decks");
  const panneau = page.getByRole("complementary", { name: "Deck en cours" });

  await panneau.getByRole("button", { name: "Partager" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "deck_share")).toEqual({ type: "deck_share", id: 1 });
  envoyer({ type: "deck_shared", code: "ABCD2345", published: false });
  const boite = page.getByRole("alertdialog", { name: "Code du deck" });
  await expect(boite.getByText("ABCD2345")).toBeVisible();
  await boite.getByRole("button", { name: "Fermer" }).click();
  await expect(boite).toHaveCount(0);

  await panneau.getByRole("button", { name: "Publier", exact: true }).click();
  await panneau.getByRole("textbox", { name: "Nom affiché" }).fill("Mon Goat");
  await panneau.getByRole("textbox", { name: "Description (facultative)" }).fill("Rapide et simple");
  await panneau.getByRole("button", { name: "Publier ce deck" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "deck_publish")).toEqual({ type: "deck_publish", id: 1, name: "Mon Goat", description: "Rapide et simple" });
  envoyer({ type: "deck_shared", code: "WXYZ6789", published: true });
  await expect(boite.getByText("Deck publié dans Decks publics.")).toBeVisible();
});

test("la page Decks publics filtre la liste, et seul l'auteur ou l'admin peut retirer un deck", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { cartes: CARTES });
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  await aller(page, "Decks publics");
  await expect.poll(() => envoyes.find((msg) => msg.type === "public_decks")).toEqual({ type: "public_decks", sort: "copies" });
  envoyer({ type: "public_decks", decks: [publie, { ...publie, code: "WXYZ6789", name: "Mon deck", mine: true }] });
  const decks = page.getByRole("list").filter({ hasText: "Goat sage" });
  await expect(decks.getByText("par Kaiba").first()).toBeVisible();
  await expect(decks.getByText("Conforme Goat").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(1);

  await page.getByRole("combobox", { name: "Format" }).selectOption("goat");
  await expect.poll(() => envoyes.findLast((msg) => msg.type === "public_decks")).toEqual({ type: "public_decks", sort: "copies", goat: true });
  await page.getByRole("combobox", { name: "Tri" }).selectOption("recent");
  await expect.poll(() => envoyes.findLast((msg) => msg.type === "public_decks")).toEqual({ type: "public_decks", sort: "recent", goat: true });

  await page.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("button", { name: "Confirmer le retrait" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "deck_unpublish")).toEqual({ type: "deck_unpublish", code: "WXYZ6789" });
  envoyer({ type: "public_deck_removed", code: "WXYZ6789" });
  await expect(page.getByText("Mon deck")).toHaveCount(0);

  envoyer({ type: "profile", pseudo: "Yugi", needsStarter: false, admin: true });
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(1);
});
