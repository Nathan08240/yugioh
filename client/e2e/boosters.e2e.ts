import { expect, test } from "@playwright/test";
import { aller, lancer } from "./harnais.ts";

const MONSTRE = 90357090;
const [NIVEAU7, MAGIE, PIEGE, AUTRE_NIVEAU7, AUTRE_MAGIE] = [46986414, 55144522, 50045299, 6368038, 12580477];
// In reveal order, from the least to the most rare; no printing twice, as in a real pack.
const cartes = [
  ...[NIVEAU7, MAGIE, PIEGE, AUTRE_NIVEAU7, AUTRE_MAGIE, MONSTRE].map((code) => ({ code, rarity: "common" })),
  { code: MONSTRE, rarity: "shortprint" },
  { code: NIVEAU7, rarity: "rare" },
  { code: MAGIE, rarity: "super" },
];

test("ouvrir un booster : le paquet s'ouvre, les cartes se révèlent une à une, puis retour aux boosters", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await aller(page, "Boosters");
  await expect.poll(() => envoyes.some((msg) => msg.type === "booster_state")).toBe(true);
  envoyer({ type: "booster_state", nextFreeAt: new Date(Date.now() + 3_600_000).toISOString(), pending: 2, ultraIn: 5 });
  envoyer({ type: "collection", cards: [[MONSTRE, 1]], rarities: [], points: 0 });

  const ouvrir = page.getByRole("button", { name: "Ouvrir le booster" });
  await expect(ouvrir).toBeEnabled();
  await expect(page.getByText("2 boosters à ouvrir.")).toBeVisible();
  await ouvrir.click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "open_booster")).toEqual({ type: "open_booster", set: "LOB" });
  envoyer({ type: "booster_opened", set: "LOB", cards: cartes });
  envoyer({ type: "booster_state", nextFreeAt: new Date(Date.now() + 3_600_000).toISOString(), pending: 1, ultraIn: 4 });

  const ouverture = page.getByRole("dialog", { name: "Ouverture du booster Legend of Blue Eyes White Dragon" });
  const compte = ouverture.locator(".ouverture__compte");
  await expect(compte).toHaveText("0 / 9");
  // The pack opens by itself, then each touch of the pile reveals the next card.
  await ouverture.getByRole("button", { name: "Révéler la carte suivante" }).click();
  await expect(compte).toHaveText("1 / 9");
  await expect(ouverture.locator(".revelation__rarete")).toHaveText("Commune");
  await expect(ouverture.getByText("Nouvelle carte")).toBeVisible();

  await ouverture.getByRole("button", { name: "Tout révéler" }).click();
  await expect(compte).toHaveText("9 / 9");
  await expect(ouverture.getByRole("list", { name: "Cartes du booster" }).getByRole("listitem")).toHaveCount(8);
  await expect(ouverture.getByRole("status")).toHaveText("9 cartes ajoutées à votre collection, dont 5 nouvelles.");
  await expect(ouverture.getByRole("button", { name: "Ouvrir le suivant (1 restant)" })).toBeVisible();

  await ouverture.getByRole("button", { name: "Retour aux boosters" }).click();
  await expect(ouverture).toBeHidden();
  await expect(ouvrir).toBeVisible();
});

test("Ouvrir le suivant lance l'ouverture d'un autre booster du même set", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await aller(page, "Boosters");
  await expect.poll(() => envoyes.some((msg) => msg.type === "booster_state")).toBe(true);
  envoyer({ type: "booster_state", nextFreeAt: new Date(Date.now() + 3_600_000).toISOString(), pending: 2, ultraIn: 5 });
  await page.getByRole("button", { name: "Ouvrir le booster" }).click();
  envoyer({ type: "booster_opened", set: "LOB", cards: cartes });

  const ouverture = page.getByRole("dialog", { name: /Ouverture du booster/ });
  await ouverture.getByRole("button", { name: "Tout révéler" }).click();
  await ouverture.getByRole("button", { name: "Ouvrir le suivant (2 restants)" }).click();
  await expect.poll(() => envoyes.filter((msg) => msg.type === "open_booster")).toHaveLength(2);
});
