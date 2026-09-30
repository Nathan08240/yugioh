import { expect, test } from "@playwright/test";
import type { DraftRun } from "../../server/src/protocol.ts";
import { CARTES, lancer } from "./harnais.ts";

// A phone in portrait.
test.use({ viewport: { width: 375, height: 812 } });

const codes = Object.keys(CARTES).map(Number);
const pack = [...codes.map((code) => ({ code, rarity: "common" })), ...codes.slice(0, 3).map((code) => ({ code, rarity: "rare" }))];
const run: DraftRun = { id: 1, set: "LOB", setName: "Legend of Blue Eyes White Dragon", pool: [], main: null, extra: null, wins: 0, losses: 0, status: "drafting", boosters: 0, round: 1, pack };

test("le draft se joue d'un tap : le booster tient dans l'écran, la carte prise part au serveur une seule fois", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page);
  await page.getByRole("button", { name: /Mode Draft/ }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "draft")).toBe(true);
  envoyer({ type: "draft", run });

  const booster = page.getByRole("list", { name: "Booster en cours" });
  await expect(booster.getByRole("button")).toHaveCount(9);
  const box = await booster.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 376).toBe(true);
  const piege = booster.getByRole("button", { name: "Prendre Piège à poser" });
  await piege.click();
  await expect(piege).toBeDisabled();
  await piege.click({ force: true });
  expect(envoyes.filter((msg) => msg.type === "draft_pick")).toEqual([{ type: "draft_pick", index: 3 }]);

  envoyer({ type: "draft", run: { ...run, pool: [pack[3]], pack: pack.filter((_, i) => i !== 3) } });
  await expect(page.getByText("Choix 2 sur 9")).toBeVisible();
  await expect(page.getByText("1 carte prise : 0 monstre · 0 fusion · 0 magie · 1 piège")).toBeVisible();
  await expect(booster.getByRole("button").first()).toBeEnabled();
});
