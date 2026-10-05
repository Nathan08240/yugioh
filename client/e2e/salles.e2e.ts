import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test("l'hôte choisit les règles de sa salle, l'invité les voit avant de rejoindre", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);

  await page.getByRole("button", { name: "Créer une salle" }).click();
  const formulaire = page.getByRole("form", { name: "Règles de la salle" });
  await formulaire.getByRole("radio", { name: "8000" }).check();
  await formulaire.getByRole("radio", { name: "6", exact: true }).check();
  await formulaire.getByRole("radio", { name: "Battle City" }).check();
  await formulaire.getByRole("button", { name: "Créer la salle" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "create")).toEqual({ type: "create", options: { lp: 8000, hand: 6, goat: false, rule: "battle-city" } });

  // A code typed by a guest first asks for the rules; a room with custom rules waits for an answer.
  await page.reload();
  await page.getByLabel("Code de la salle").first().fill("ABCDE");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "room_rules")).toEqual({ type: "room_rules", room: "ABCDE" });
  envoyer({ type: "room_rules", room: "ABCDE", options: { lp: 8000, hand: 6, goat: true, rule: "battle-city" } });
  const apercu = page.getByRole("alertdialog", { name: "Règles de la salle ABCDE" });
  await expect(apercu).toContainText("8000 LP de départ.");
  await expect(apercu).toContainText("Battle City");
  expect(envoyes.some((msg) => msg.type === "join")).toBe(false);
  await apercu.getByRole("button", { name: "Accepter et rejoindre" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "join")).toEqual({ type: "join", room: "ABCDE" });
});

test.describe("sur un téléphone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("le formulaire des règles et l'aperçu tiennent dans l'écran", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
    const { envoyer } = await lancer(page);
    await page.getByRole("button", { name: "Créer une salle" }).click();
    const formulaire = page.getByRole("form", { name: "Règles de la salle" });
    await formulaire.getByRole("radio", { name: "Battle City" }).check();
    const largeur = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await largeur()).toBeLessThanOrEqual(0);
    const boite = await formulaire.boundingBox();
    expect(boite && boite.x >= 0 && boite.x + boite.width <= 375).toBe(true);
    envoyer({ type: "room_rules", room: "ABCDE", options: { lp: 8000, hand: 6, goat: true, rule: "battle-city" } });
    const apercu = await page.getByRole("alertdialog", { name: "Règles de la salle ABCDE" }).boundingBox();
    expect(apercu && apercu.x >= 0 && apercu.x + apercu.width <= 375 && apercu.y >= 0 && apercu.y + apercu.height <= 812).toBe(true);
  });
});
