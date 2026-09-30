import { OcgResponseType } from "@n1xx1/ocgcore-wasm";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CARTES, lancer } from "./harnais.ts";

// A phone in portrait.
test.use({ viewport: { width: 375, height: 812 } });

const PAGES = ["Accueil", "Collection et decks", "Boosters", "Mode Histoire", "Règles", "Profil", "Amis", "Paramètres"];

// Visible elements that stick out of the screen sideways, outside a box that scrolls or clips on its own and outside decorations.
const debordements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || (r.left >= -1 && r.right <= innerWidth + 1) || el.closest("[aria-hidden='true']")) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return false;
        return true;
      })
      .map((el) => el.outerHTML.slice(0, 80)),
  );

async function allerA(page: Page, label: string) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: label }).click();
}

async function dansLEcran(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 376 && box.y + box.height <= 813).toBe(true);
}

test("le menu se replie derrière un bouton, s'ouvre et mène aux pages", async ({ page }) => {
  await lancer(page);
  const menu = page.getByRole("navigation", { name: "Menu principal" });
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(menu).toBeVisible();
  for (const bouton of await menu.getByRole("button").all()) expect((await bouton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await menu.getByRole("button", { name: "Profil" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("heading", { name: "Yugi", level: 1 })).toBeVisible();
});

test("aucun écran principal ne déborde sur le côté", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  const codes = Object.keys(CARTES).map(Number);
  envoyer({ type: "collection", cards: codes.map((code) => [code, 3]), rarities: [], points: 0 });
  envoyer({ type: "decks", decks: [{ id: 1, name: "Deck de Yugi", main: codes, extra: [] }], active: 1 });
  envoyer({ type: "booster_state", nextFreeAt: new Date(Date.now() + 3_600_000).toISOString(), pending: 1, ultraIn: 5 });
  for (const label of PAGES) {
    await allerA(page, label);
    await expect(page.locator("#menu-principal [aria-current=page]")).toContainText(label);
    expect(await debordements(page), label).toEqual([]);
  }
});

test("dans la collection, la fiche d'une carte s'ouvre en plein écran et se ferme", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page);
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  const codes = Object.keys(CARTES).map(Number);
  envoyer({ type: "collection", cards: codes.map((code) => [code, 3]), rarities: [], points: 0 });
  envoyer({ type: "decks", decks: [{ id: 1, name: "Deck de Yugi", main: codes, extra: [] }], active: 1 });
  await allerA(page, "Collection et decks");
  const fiche = page.getByRole("complementary", { name: "Détail de la carte" });
  await expect(fiche).toBeHidden();
  await page.getByRole("button", { name: "Voir Autre magie" }).click();
  await expect(fiche).toBeVisible();
  expect(await fiche.boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 812 });
  await fiche.getByRole("button", { name: "Fermer la fiche" }).click();
  await expect(fiche).toBeHidden();
});

test("en duel, la question, la main et les plaques restent dans l'écran et se touchent", async ({ page }) => {
  const { envoyes } = await lancer(page, { duel: true });
  await expect(page.getByText("À vous de répondre")).toBeVisible();
  const main = page.getByRole("region", { name: "Votre main" });
  await expect(main.getByRole("button")).toHaveCount(6);
  await dansLEcran(page.locator(".question"));
  await dansLEcran(page.locator(".plaque--moi"));
  await dansLEcran(page.locator(".plaque--adverse"));
  await dansLEcran(main.getByRole("button", { name: "Monstre invocable, jouable" }));
  expect(await debordements(page)).toEqual([]);

  await main.getByRole("button", { name: "Monstre invocable, jouable" }).click();
  const bulle = page.getByRole("dialog", { name: "Actions : Monstre invocable" });
  await expect(bulle.getByRole("button")).toHaveCount(2);
  await dansLEcran(bulle);
  await page.keyboard.press("Escape");

  // The log and the card detail fold over the board, one at a time.
  const journal = page.getByRole("region", { name: "Journal du duel" });
  await expect(journal).toBeHidden();
  await page.getByRole("button", { name: "Journal" }).click();
  await expect(journal).toBeVisible();
  await page.getByRole("button", { name: "Carte en détail" }).click();
  await expect(journal).toBeHidden();
  await expect(page.locator(".colonne__detail")).toBeVisible();
  await page.getByRole("button", { name: "Carte en détail" }).click();
  await expect(page.locator(".colonne__detail")).toBeHidden();

  await page.locator(".question").getByRole("button", { name: "End Phase" }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "respond" && msg.response.type === OcgResponseType.SELECT_IDLECMD)).toBe(true);
});
