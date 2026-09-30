import { expect, test } from "@playwright/test";
import { lancer } from "./harnais.ts";

test("depuis les amis, propose un échange parmi les doublons et répond à une offre reçue, sans déborder sur un téléphone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await expect.poll(() => envoyes.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Amis" }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "trades")).toBe(true);
  envoyer({ type: "friends", friends: [{ pseudo: "Joey", avatar: null, status: "online" }] });
  envoyer({ type: "wishlist", cards: [6368038] });
  envoyer({ type: "trades", received: [{ id: 7, pseudo: "Joey", give: 90357090, get: 46986414, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }], sent: [], left: 3 });
  await expect(page.getByRole("region", { name: "Échanges de cartes" })).toContainText("Monstre invocable");

  await page.getByRole("button", { name: "Proposer un échange" }).click();
  envoyer({ type: "trade_cards", pseudo: "Joey", mine: [[55144522, 1]], theirs: [[46986414, 2], [6368038, 1]] });
  const panneau = page.getByRole("region", { name: "Proposer un échange à Joey" });
  await expect(panneau.locator(".est-souhaitee")).toContainText("Autre monstre niveau 7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);  await panneau.locator("label", { hasText: "Magie à activer" }).click();
  await panneau.locator("label", { hasText: "Autre monstre niveau 7" }).click();
  await expect(panneau.getByRole("radio", { name: /Autre monstre niveau 7/ })).toBeChecked();
  await panneau.getByRole("button", { name: "Proposer l'échange" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "trade_offer")).toEqual({ type: "trade_offer", pseudo: "Joey", give: 55144522, get: 6368038 });
  await expect(panneau).toBeHidden();

  await page.getByRole("region", { name: "Échanges de cartes" }).getByRole("button", { name: "Accepter" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "trade_accept")).toEqual({ type: "trade_accept", id: 7 });
});
