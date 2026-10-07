import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
});

test("la partie rapide : entrer en file puis annuler l'attente", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page);
  const jouer = page.getByRole("region", { name: "Jouer" });
  await jouer.getByRole("button", { name: "Partie rapide" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "quick_queue")).toEqual({ type: "quick_queue" });
  envoyer({ type: "quick_queue", waiting: true });
  await expect(jouer.getByRole("status").filter({ hasText: "Recherche d'un adversaire…" })).toBeVisible();
  await expect(jouer.getByRole("button", { name: "Partie rapide" })).toBeHidden();
  await expect(jouer.getByText("Personne pour l'instant")).toBeHidden();

  await jouer.getByRole("button", { name: "Annuler" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "quick_cancel")).toEqual({ type: "quick_cancel" });
  envoyer({ type: "quick_queue", waiting: false });
  await expect(jouer.getByRole("button", { name: "Partie rapide" })).toBeVisible();
});

test("la partie rapide propose le bot après 30 secondes sans adversaire", async ({ page }) => {
  await page.clock.install();
  const { envoyes, envoyer } = await lancer(page);
  const jouer = page.getByRole("region", { name: "Jouer" });
  await jouer.getByRole("button", { name: "Partie rapide" }).click();
  envoyer({ type: "quick_queue", waiting: true });
  await expect(jouer.getByRole("status")).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(jouer.getByText("Personne pour l'instant")).toBeVisible();

  await jouer.getByRole("button", { name: "Bot expert" }).click();
  await expect.poll(() => envoyes.filter((msg) => msg.type === "quick_cancel" || msg.type === "bot")).toEqual([{ type: "quick_cancel" }, { type: "bot", level: "expert" }]);
});
