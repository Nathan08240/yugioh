import { expect, test } from "@playwright/test";
import recorded from "../src/fixtures/duel.json" with { type: "json" };
import { aller, DEBUT_DU_DUEL, lancer } from "./harnais.ts";

test("les leçons : depuis les règles, la liste, puis une leçon guidée par ses bulles", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await aller(page, "Règles");
  await page.getByRole("button", { name: "Leçons avancées" }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "lessons")).toBe(true);
  envoyer({
    type: "lessons",
    lessons: [
      { id: "fusion", title: "Fusion", goal: "Fusionnez deux monstres.", done: true },
      { id: "chaine", title: "Répondre en chaîne", goal: "Répondez au Piège adverse.", done: false },
    ],
  });
  await expect(page.getByRole("heading", { name: "Techniques avancées", level: 1 })).toBeVisible();
  await expect(page.getByText("1 réussie sur 2")).toBeVisible();
  await expect(page.getByText("+15 points")).toBeVisible();

  await page.getByRole("button", { name: "Jouer Répondre en chaîne" }).click();
  await expect.poll(() => envoyes).toContainEqual({ type: "lesson", id: "chaine" });
  envoyer({ type: "joined", room: "E2E42", seat: 0, lp: recorded.lp, decks: recorded.decks, extras: [0, 0], opponent: "Bot", log: [] });
  for (const message of DEBUT_DU_DUEL) envoyer(message);
  await expect(page.getByRole("region", { name: "Leçon" })).toContainText("Leçon · étape 1 sur 3");
  await expect(page.getByRole("button", { name: "Quitter la leçon" })).toBeVisible();
});
