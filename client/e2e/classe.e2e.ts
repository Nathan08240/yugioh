import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test("le classé : entrer en file puis annuler la recherche", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await page.getByRole("button", { name: "Jouer en classé" }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "ranked")).toBe(true);
  envoyer({
    type: "ranked",
    rating: 1040,
    games: 6,
    season: "2026-10",
    daysLeft: 12,
    seasonGames: 3,
    leaderboard: [{ pseudo: "Yugi", avatar: null, rating: 1040, games: 3 }],
    previousSeason: "2026-09",
    previousLeaderboard: [],
    lastResult: null,
  });
  await expect(page.getByRole("heading", { name: "Classement 1040", level: 1 })).toBeVisible();
  await expect(page.getByRole("row", { name: /Yugi/ })).toHaveAttribute("aria-current", "true");

  await page.getByRole("button", { name: "Chercher un adversaire" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "ranked_queue")).toEqual({ type: "ranked_queue" });
  envoyer({ type: "ranked_queue", waiting: true });
  await expect(page.getByRole("status").filter({ hasText: "Recherche d'un adversaire…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chercher un adversaire" })).toBeHidden();

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "ranked_cancel")).toEqual({ type: "ranked_cancel" });
  envoyer({ type: "ranked_queue", waiting: false });
  await expect(page.getByRole("button", { name: "Chercher un adversaire" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Annuler" })).toBeHidden();
});
