import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test("la vitesse choisie dans les Paramètres est gardée au rechargement", async ({ page }) => {
  await lancer(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Paramètres" }).click();
  const vitesse = page.getByRole("group", { name: "Vitesse des animations" });
  await expect(vitesse.getByRole("radio", { name: "Normale" })).toBeChecked();
  await vitesse.getByRole("radio", { name: "Rapide" }).check();

  await page.reload();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Paramètres" }).click();
  await expect(page.getByRole("group", { name: "Vitesse des animations" }).getByRole("radio", { name: "Rapide" })).toBeChecked();
});
