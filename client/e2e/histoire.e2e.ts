import { expect, test, type Page } from "@playwright/test";
import type { StoryArcView, StoryDuelView } from "../../server/src/protocol.ts";
import { aller, lancer } from "./harnais.ts";

const duel = (id: string, title: string, opponent: string, extra: Partial<StoryDuelView> = {}): StoryDuelView => ({
  id,
  title,
  opponent,
  lp: 4000,
  hand: 5,
  special: [],
  intro: `${opponent} vous attend de l'autre côté du plateau.`,
  rewards: { boosters: 1 },
  requires: [],
  status: "available",
  stars: 0,
  ...extra,
});

const ARCS: StoryArcView[] = [
  {
    id: "royaume",
    title: "Royaume des Duellistes",
    duels: [duel("r1", "Premier duel", "Weevil", { status: "done", stars: 3 }), duel("r2", "Le roi du jeu", "Pegasus", { status: "done", stars: 2 })],
    revenge: duel("r2-revanche", "Pegasus, la revanche", "Pegasus"),
  },
  {
    id: "kaiba",
    title: "Le parcours de Kaiba",
    duels: [
      duel("k1", "Le défi de Kaiba", "Seto Kaiba", { player: { name: "Kaiba", deck: [[90357090, 3], [46986414, 2]], extra: [[50045299, 1]] } }),
      duel("k2", "Le Dragon Blanc", "Seto Kaiba", { status: "locked", requires: ["k1"] }),
    ],
    revenge: duel("k2-revanche", "Kaiba, la revanche", "Seto Kaiba", { status: "locked" }),
  },
  { id: "battle-city", title: "Battle City", duels: [duel("b1", "Le tournoi", "Bandit Keith", { status: "locked" })] },
];

// The story screen, fed with ARCS once it asked for them.
async function ouvrirHistoire(page: Page) {
  await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
  const { envoyes, envoyer } = await lancer(page);
  await aller(page, "Mode Histoire");
  await expect.poll(() => envoyes.some((msg) => msg.type === "story")).toBe(true);
  envoyer({ type: "story", arcs: ARCS });
  return { envoyes };
}

test("la liste des arcs montre l'arc en cours, la progression et les arcs verrouillés", async ({ page }) => {
  await ouvrirHistoire(page);
  await expect(page.getByRole("heading", { name: "Le parcours de Kaiba", level: 1 })).toBeVisible();
  await expect(page.getByText("2 duels gagnés sur 5")).toBeVisible();

  const arcs = page.getByRole("list", { name: "Arcs" }).getByRole("button");
  await expect(arcs).toHaveCount(3);
  await expect(arcs.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(arcs.nth(0)).toContainText("2 / 2");
  await expect(arcs.nth(2)).toBeDisabled();
  await expect(arcs.nth(2)).toContainText("Verrouillé");

  const duels = page.getByRole("list", { name: "Duels de Le parcours de Kaiba" });
  await expect(duels.getByRole("button", { name: "Voir le duel" })).toHaveCount(1);
  await expect(duels).toContainText("Gagnez le duel 1 pour le débloquer.");
  // Another arc keeps the same screen, its own duels.
  await arcs.nth(0).click();
  await expect(page.getByRole("heading", { name: "Royaume des Duellistes", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Duels de Royaume des Duellistes" }).getByRole("button", { name: /Rejouer/ })).toHaveCount(2);
});

test("le briefing d'un duel donne l'adversaire, le deck imposé et le mode facile double les LP au lancement", async ({ page }) => {
  const { envoyes } = await ouvrirHistoire(page);
  await page.getByRole("button", { name: "Voir le duel" }).click();
  await expect(page.getByRole("heading", { name: "Le défi de Kaiba", level: 1 })).toBeVisible();
  await expect(page.getByText("Seto Kaiba vous attend de l'autre côté du plateau.")).toBeVisible();
  await expect(page.getByText("4000 LP", { exact: true })).toBeVisible();

  // The Kaiba course imposes a deck: it replaces the active one.
  const deckImpose = page.locator("details", { hasText: "Deck imposé" });
  await expect(deckImpose.locator("summary")).toHaveText("Deck imposé : Kaiba, 5 cartes");
  await expect(deckImpose.getByRole("listitem")).toHaveText(["3 × Monstre invocable", "2 × Monstre niveau 7", "1 × Piège à poser"]);

  const difficulte = page.getByRole("group", { name: "Difficulté" });
  await expect(difficulte.getByRole("radio", { name: "Normal" })).toBeChecked();
  await expect(difficulte).toContainText("Le duel tel qu'il a été écrit.");
  await difficulte.getByRole("radio", { name: "Facile" }).check();
  await expect(difficulte).toContainText("Vos LP de départ sont doublés (8000 LP).");

  await page.getByRole("button", { name: "Lancer le duel" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "story_duel")).toEqual({ type: "story_duel", duel: "k1", level: "facile" });
});

test("Retour aux duels ferme le briefing, un duel sans deck imposé n'en montre pas", async ({ page }) => {
  await ouvrirHistoire(page);
  await page.getByRole("list", { name: "Arcs" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Rejouer Premier duel" }).click();
  await expect(page.getByRole("heading", { name: "Premier duel", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rejouer le duel" })).toBeVisible();
  await expect(page.getByText("Deck imposé")).toBeHidden();
  await page.getByRole("button", { name: "Retour aux duels" }).click();
  await expect(page.getByRole("heading", { name: "Royaume des Duellistes", level: 1 })).toBeVisible();
});

test("la revanche d'un arc terminé se lance sans niveau, celle d'un arc en cours reste fermée", async ({ page }) => {
  const { envoyes } = await ouvrirHistoire(page);
  await expect(page.getByText("Terminez l'arc pour défier de nouveau Seto Kaiba.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Défier en revanche" })).toBeHidden();

  await page.getByRole("list", { name: "Arcs" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Défier en revanche" }).click();
  await expect(page.getByRole("heading", { name: "Pegasus, la revanche", level: 1 })).toBeVisible();
  await expect(page.getByText("Royaume des Duellistes · Revanche")).toBeVisible();
  await expect(page.getByText("Deck renforcé et adversaire au niveau Expert, sans étoiles ni niveau Facile.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Difficulté" })).toBeHidden();
  await page.getByRole("button", { name: "Lancer le duel" }).click();
  await expect.poll(() => envoyes.find((msg) => msg.type === "story_duel")).toEqual({ type: "story_duel", duel: "r2-revanche", revenge: true });
});
