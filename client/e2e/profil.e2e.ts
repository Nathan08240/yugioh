import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test("le bilan du profil garde son titre au-dessus du tableau et tient dans son panneau", async ({ page }) => {
  // Instant animations: the page must not be measured mid-transition.
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyer } = await lancer(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Profil" }).click();
  envoyer({ type: "duel_results", results: [{ deck: 1, mode: "story", wins: 3, losses: 1 }] });
  const tableau = page.locator(".profil__bilan");
  await expect(tableau.getByRole("row", { name: /Histoire/ })).toContainText("75 %");

  const titre = await tableau.locator("caption").boundingBox();
  const entetes = await tableau.locator("thead").boundingBox();
  const panneau = await page.locator(".profil__bloc").first().boundingBox();
  const table = await tableau.boundingBox();
  expect(titre && entetes && titre.y + titre.height <= entetes.y + 1).toBe(true);
  expect(panneau && table && table.x + table.width <= panneau.x + panneau.width + 1).toBe(true);
  // A percentage stays on one line.
  const taux = await tableau.getByRole("row", { name: /Histoire/ }).locator("td").last().boundingBox();
  const ligne = await tableau.getByRole("row", { name: /Histoire/ }).locator("th").boundingBox();
  expect(taux && ligne && taux.height <= ligne.height + 1).toBe(true);
});
