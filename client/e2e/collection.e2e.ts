import { expect, test } from "@playwright/test";
import { aller, cartesFactices, lancer } from "./harnais.ts";

const PAS = 120;
const TOTAL = 1300;
const CARTES = cartesFactices(TOTAL);

test("une grande collection affiche 120 cartes, puis la suite au défilement", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page, { cartes: CARTES });
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  envoyer({ type: "collection", cards: Object.keys(CARTES).map((code) => [Number(code), 1]), rarities: [], points: 0 });
  envoyer({ type: "decks", decks: [], active: null });
  await aller(page, "Collection et decks");

  const grille = page.getByRole("region", { name: "Collection" }).locator(".grille-collection");
  await expect(page.getByText(`${TOTAL} cartes affichées · ${TOTAL} possédées`)).toBeVisible();
  const cartes = grille.getByRole("listitem");
  await expect(cartes).toHaveCount(PAS);

  // The sentinel after the last card loads the next step when the grid is scrolled to it.
  await grille.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(cartes).toHaveCount(2 * PAS);
  await grille.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(cartes).toHaveCount(3 * PAS);
  await expect(cartes.last()).toContainText("×1");
});
