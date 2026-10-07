import { expect, test, type Page } from "@playwright/test";
import type { AdminReport, ServerMessage, Wire } from "../../server/src/protocol.ts";
import recorded from "../src/fixtures/duel.json" with { type: "json" };
import { aller, lancer } from "./harnais.ts";

const batches = (recorded.received as Wire<ServerMessage>[]).flatMap((msg) => (msg.type === "messages" ? [msg.messages] : []));
const menu = (page: Page) => page.getByRole("navigation", { name: "Menu principal" });
const signalement: AdminReport = { id: 7, date: "2026-10-08T10:00:00.000Z", pseudo: "Kaiba", mode: "online", turn: 4, message: "Le monstre ne s'invoque pas", handled: false };

test("un joueur ordinaire n'a pas d'entrée Admin dans le menu", async ({ page }) => {
  await lancer(page);
  await expect(menu(page).getByRole("button", { name: "Profil" })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: "Admin" })).toHaveCount(0);
});

test("l'admin lit les signalements, rejoue un duel de l'un des deux côtés, le marque traité et lit les erreurs", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await expect(menu(page).getByRole("button", { name: "Profil" })).toBeVisible();
  envoyer({ type: "profile", pseudo: "Yugi", needsStarter: false, admin: true });
  await aller(page, "Admin");
  await expect.poll(() => ["admin_reports", "admin_errors"].every((type) => envoyes.some((msg) => msg.type === type))).toBe(true);
  envoyer({ type: "admin_reports", reports: [signalement] });
  const ligne = page.getByRole("row", { name: /Kaiba/ });
  await expect(ligne).toContainText("Le monstre ne s'invoque pas");

  await ligne.getByRole("button", { name: "Revoir côté 2" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "admin_report_replay")).toEqual({ type: "admin_report_replay", id: 7, seat: 1 });
  envoyer({ type: "replay", id: 7, seat: 1, lp: recorded.lp, decks: recorded.decks, extras: [0, 0], opponent: "Siège 1", self: "Siège 2", batches, emotes: [] });
  await expect(page.locator(".plaque--adverse")).toContainText("Siège 1");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Quitter le rejeu" }).click();

  await ligne.getByRole("button", { name: "Marquer traité" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "admin_report_handled")).toEqual({ type: "admin_report_handled", id: 7, handled: true });
  envoyer({ type: "admin_reports", reports: [{ ...signalement, handled: true }] });
  await expect(ligne.getByRole("button", { name: "Rouvrir" })).toBeVisible();

  await page.getByRole("button", { name: "Erreurs du navigateur" }).click();
  envoyer({
    type: "admin_errors",
    errors: [{ id: 2, kind: "error", message: "TypeError: x is undefined", stack: "TypeError\n    at f", page: "profil", build: "2026-10-08 11:00", browser: "Edge", pseudo: "Joey", count: 12, firstSeen: "2026-10-07T10:00:00.000Z", lastSeen: "2026-10-08T10:00:00.000Z" }],
  });
  const erreur = page.getByRole("row", { name: /x is undefined/ });
  await expect(erreur).toContainText("12");
  await expect(erreur).toContainText("Joey");
});

test("les erreurs non rattrapées du navigateur partent au serveur, une seule fois chacune", async ({ page }) => {
  const { envoyes } = await lancer(page);
  await expect(menu(page).getByRole("button", { name: "Profil" })).toBeVisible();
  await page.evaluate(() => {
    const planter = () => {
      throw new Error("plantage e2e");
    };
    for (let i = 0; i < 3; i++) setTimeout(planter, 0);
    Promise.reject(new Error("refus e2e"));
  });
  await expect.poll(() => envoyes.filter((msg) => msg.type === "client_error").length).toBe(2);
  const erreurs = envoyes.flatMap((msg) => (msg.type === "client_error" ? [msg] : []));
  expect(erreurs.map((msg) => [msg.kind, msg.message])).toEqual(expect.arrayContaining([["error", "Error: plantage e2e"], ["rejection", "Error: refus e2e"]]));
  expect(erreurs[0]).toMatchObject({ page: "accueil", build: expect.stringMatching(/^\d{4}-/), browser: expect.stringContaining("Edg") });
});
