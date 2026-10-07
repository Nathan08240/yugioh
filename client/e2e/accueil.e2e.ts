import { expect, test } from "@playwright/test";
import type { MissionView } from "../../server/src/protocol.ts";
import { lancer } from "./harnais.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
});

test("le bloc Jouer lance un duel contre le bot au niveau choisi", async ({ page }) => {
  const { envoyes } = await lancer(page);
  const jouer = page.getByRole("region", { name: "Jouer" });
  for (const niveau of ["Débutant", "Normal", "Expert"]) await jouer.getByRole("button", { name: niveau, exact: true }).click();
  await expect.poll(() => envoyes.filter((msg) => msg.type === "bot")).toEqual([
    { type: "bot", level: "debutant" },
    { type: "bot", level: "normal" },
    { type: "bot", level: "expert" },
  ]);
  await expect(jouer.getByRole("button", { name: "Créer une salle" })).toBeVisible();
  await expect(jouer.getByRole("button", { name: "Jouer en classé" })).toBeVisible();
});

const missions: MissionView[] = [
  { id: "m1", text: "Gagnez un duel contre le bot", progress: 1, goal: 1, reward: { points: 50 } },
  { id: "m2", text: "Gagnez 3 duels du mode Histoire", progress: 1, goal: 3, reward: { boosters: 1 } },
  { id: "m3", text: "Ouvrez 2 boosters", progress: 0, goal: 2, reward: { points: 30, boosters: 1 } },
];

test("les missions du jour sont lisibles avec leur récompense et leur progression", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page);
  await expect.poll(() => envoyes.some((msg) => msg.type === "missions")).toBe(true);
  envoyer({ type: "missions", missions, achievements: [] });

  const bloc = page.getByRole("region", { name: /Missions du jour/ });
  await expect(bloc.getByRole("heading")).toContainText("1 / 3");
  const lignes = bloc.getByRole("listitem");
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toContainText("Gagnez un duel contre le bot");
  await expect(lignes.nth(0)).toContainText("50 points");
  await expect(lignes.nth(0).getByRole("img", { name: "Fait" })).toBeVisible();
  await expect(lignes.nth(0).locator(".jauge")).toHaveAttribute("style", /--v: 100%/);
  await expect(lignes.nth(1)).toContainText("1 booster");
  await expect(lignes.nth(1)).toContainText("1 / 3");
  await expect(lignes.nth(1).locator(".jauge")).toHaveAttribute("style", /--v: 33\.3/);
  await expect(lignes.nth(2)).toContainText("30 points et 1 booster");
  await expect(lignes.nth(2)).toContainText("0 / 2");
  await expect(lignes.nth(2).locator(".jauge")).toHaveAttribute("style", /--v: 0%/);
  await expect(bloc).toContainText("Les 3 faites : 1 booster en plus.");

  // No line sticks out of the block.
  const cadre = await bloc.boundingBox();
  for (const ligne of await lignes.all()) {
    const boite = await ligne.boundingBox();
    expect(cadre && boite && boite.x >= cadre.x && boite.x + boite.width <= cadre.x + cadre.width && boite.y + boite.height <= cadre.y + cadre.height).toBe(true);
  }

  envoyer({ type: "missions", missions: missions.map((mission) => ({ ...mission, progress: mission.goal })), achievements: [] });
  await expect(bloc.getByRole("img", { name: "Fait" })).toHaveCount(3);
  await expect(bloc).toContainText("Les 3 missions sont faites : booster bonus gagné.");
});

test("le code de salle sert à rejoindre une salle standard ou à regarder son duel", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page);
  const code = page.getByRole("textbox", { name: "Code de la salle" });

  await code.fill("abcde");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "room_rules")).toEqual({ type: "room_rules", room: "ABCDE" });
  // A standard room needs no acceptance: the client joins as soon as it knows there are no custom rules.
  envoyer({ type: "room_rules", room: "ABCDE" });
  await expect.poll(() => envoyes.find((msg) => msg.type === "join")).toEqual({ type: "join", room: "ABCDE" });

  await code.fill("zz9yy");
  await page.getByRole("button", { name: "Regarder le duel" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "spectate")).toEqual({ type: "spectate", room: "ZZ9YY" });
  expect(envoyes.filter((msg) => msg.type === "join")).toHaveLength(1);
});
