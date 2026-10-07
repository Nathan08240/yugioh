import { expect, test, type Page } from "@playwright/test";
import type { Deck } from "../../server/src/protocol.ts";
import { aller, cartesFactices, lancer } from "./harnais.ts";

// 14 cards owned 3 times; the deck holds 13 of them 3 times: 39 cards, one short.
const CARTES = cartesFactices(14);
const CODES = Object.keys(CARTES).map(Number);
const deck: Deck = { id: 1, name: "Deck de test", main: CODES.slice(0, 13).flatMap((code) => [code, code, code]), extra: [] };
const AJOUTEE = CODES[13];
const NOM = "Carte factice 0014";
const INCOMPLET = "le main deck doit compter 40 à 60 cartes";
const VALIDE = "Deck valide : il peut servir en duel.";

async function ouvrir(page: Page) {
  const { envoyes, envoyer } = await lancer(page, { cartes: CARTES });
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  envoyer({ type: "collection", cards: CODES.map((code) => [code, 3]), rarities: [], points: 0 });
  envoyer({ type: "decks", decks: [deck], active: 1 });
  await aller(page, "Collection et decks");
  const panneau = page.getByRole("complementary", { name: "Deck en cours" });
  await expect(panneau.getByText(INCOMPLET)).toBeVisible();
  return { envoyes, envoyer, panneau, compteur: panneau.locator(".deck-compteurs p", { hasText: "Principal" }).locator(".chiffres") };
}

test("ajouter et retirer une carte met le compteur à jour, le deck complet s'enregistre", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer, panneau, compteur } = await ouvrir(page);
  const enregistrer = panneau.getByRole("button", { name: "Enregistrer" });
  await expect(compteur).toHaveText("39");
  await expect(panneau.getByRole("button", { name: "Enregistré" })).toBeDisabled();

  await page.getByRole("button", { name: `${NOM} : 0 dans le deck sur 3 possédées` }).click();
  await expect(compteur).toHaveText("40");
  await expect(panneau.getByText(VALIDE)).toBeVisible();
  await expect(page.getByRole("button", { name: `${NOM} : 1 dans le deck sur 3 possédées` })).toBeVisible();
  await enregistrer.click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "save_deck")).toEqual({ type: "save_deck", deck: { ...deck, main: [...deck.main, AJOUTEE] } });
  envoyer({ type: "decks", decks: [{ ...deck, main: [...deck.main, AJOUTEE] }], active: 1, saved: 1 });
  await expect(panneau.getByRole("button", { name: "Enregistré" })).toBeDisabled();

  await panneau.getByRole("button", { name: `Retirer un exemplaire de ${NOM}` }).click();
  await expect(compteur).toHaveText("39");
  await expect(panneau.getByText(INCOMPLET)).toBeVisible();
  await expect(page.getByRole("button", { name: `${NOM} : 0 dans le deck sur 3 possédées` })).toBeVisible();
});

test("un deck invalide affiche la règle enfreinte et ne peut pas être enregistré", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, panneau } = await ouvrir(page);
  const enregistrer = panneau.getByRole("button", { name: "Enregistrer" });
  await expect(panneau.locator(".deck-compteurs p", { hasText: "Principal" })).toHaveClass(/est-hors-regle/);

  // Complete but unnamed: another rule, another message.
  await page.getByRole("button", { name: `${NOM} : 0 dans le deck sur 3 possédées` }).click();
  await panneau.getByRole("textbox", { name: "Nom du deck" }).fill("");
  await expect(panneau.getByText("le nom du deck doit faire 1 à 40 caractères")).toBeVisible();
  await expect(enregistrer).toBeDisabled();

  await panneau.getByRole("textbox", { name: "Nom du deck" }).fill("Deck renommé");
  await expect(panneau.getByText(VALIDE)).toBeVisible();
  await expect(enregistrer).toBeEnabled();
  expect(envoyes.some((msg) => msg.type === "save_deck")).toBe(false);
});
