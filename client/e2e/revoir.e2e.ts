import { expect, test } from "@playwright/test";
import type { ServerMessage, Wire } from "../../server/src/protocol.ts";
import recorded from "../src/fixtures/duel.json" with { type: "json" };
import { lancer } from "./harnais.ts";

const batches = (recorded.received as Wire<ServerMessage>[]).flatMap((msg) => (msg.type === "messages" ? [msg.messages] : []));

test("« Revoir » depuis le profil rejoue le duel sur le plateau, avec pause, vitesse et tour suivant", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Profil" }).click();
  await expect.poll(() => envoyes.some((msg) => msg.type === "replays")).toBe(true);
  envoyer({ type: "replays", replays: [{ id: 3, date: "2026-10-02T10:30:00.000Z", mode: "bot", opponent: "Kaiba", won: false }] });
  const ligne = page.locator(".profil__historique").getByRole("row", { name: /Kaiba/ });
  await expect(ligne).toContainText("Défaite");
  await ligne.getByRole("button", { name: "Revoir" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "replay")).toEqual({ type: "replay", id: 3 });

  envoyer({ type: "replay", id: 3, seat: 0, lp: recorded.lp, decks: recorded.decks, extras: [0, 0], opponent: "Kaiba", batches });
  await expect(page.locator(".plaque--adverse")).toContainText("Kaiba");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Lecture" })).toBeVisible();
  await page.getByRole("button", { name: "×4" }).click();
  await expect(page.getByRole("button", { name: "×4" })).toHaveAttribute("aria-pressed", "true");
  const tour = page.locator(".tour .surtitre").first();
  const avant = await tour.textContent();
  await page.getByRole("button", { name: "Tour suivant" }).click();
  await expect(tour).not.toHaveText(avant ?? "");
  // No answer ever goes to the server during a replay.
  expect(envoyes.some((msg) => msg.type === "respond")).toBe(false);

  await page.getByRole("button", { name: "Quitter le rejeu" }).click();
  await expect(page.locator(".profil__historique")).toBeVisible();
});
