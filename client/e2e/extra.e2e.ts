import { OcgLocation, OcgMessageType, OcgResponseType, OcgType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";
import { expect, test, type Page } from "@playwright/test";
import type { Deck } from "../../server/src/protocol.ts";
import { aller, carte, cartesFactices, lancer } from "./harnais.ts";

const { MONSTER, FUSION, SPELL } = OcgType;
const BOARD_READY = 15_000;

const POLY = 24094653;
// Cards of the recorded duel's hand (harnais.ts CARTES): both are in the hand.
const MONSTRE = 90357090;
const NIVEAU_7 = 46986414;
const AUTRE_MAGIE = 12580477;

test.describe("constructeur de deck et classeur", () => {
  const PRETE = 700_000_001;
  const PARTIELLE = 700_000_002;
  const FACTICES = cartesFactices(14);
  const CODES = Object.keys(FACTICES).map(Number);
  const cartes = {
    ...FACTICES,
    [POLY]: carte("Polymérisation", SPELL),
    [PRETE]: carte("Fusion prête", MONSTER | FUSION, [MONSTRE, CODES[0]]),
    [PARTIELLE]: carte("Fusion partielle", MONSTER | FUSION, [MONSTRE, NIVEAU_7, AUTRE_MAGIE]),
  };
  // The main deck holds Polymerization, Monstre invocable and the first 13 dummy cards three times; Niveau 7 is owned outside it, Autre magie is not owned.
  const deck: Deck = { id: 1, name: "Deck de fusion", main: [POLY, MONSTRE, ...CODES.slice(0, 13).flatMap((code) => [code, code, code])], extra: [PARTIELLE] };
  const possedees: [number, number][] = [...CODES.map((code): [number, number] => [code, 3]), [POLY, 1], [MONSTRE, 1], [NIVEAU_7, 1], [PRETE, 1], [PARTIELLE, 1]];

  async function ouvrir(page: Page) {
    await page.addInitScript(() => localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" })));
    const { envoyes, envoyer } = await lancer(page, { cartes });
    await expect.poll(() => envoyes.length).toBeGreaterThan(0);
    envoyer({ type: "collection", cards: possedees, rarities: [], points: 0 });
    envoyer({ type: "decks", decks: [deck], active: 1 });
    await aller(page, "Collection et decks");
    return page.getByRole("region", { name: "Extra Deck" });
  }

  test("le bandeau Extra Deck compte sur 15 et marque chaque matériau : dans le deck, possédé, manquant", async ({ page }) => {
    const bande = await ouvrir(page);
    await expect(bande).toContainText("1 / 15");
    await expect(bande.getByRole("listitem").filter({ hasText: "Fusion partielle" })).toBeVisible();
    await expect(bande.getByRole("list", { name: "Matériaux" }).getByRole("listitem")).toHaveText([/Monstre invocable.*Dans le deck/, /Monstre niveau 7.*Possédé/, /Autre magie.*Manquant/]);
    // The main deck holds Polymerization, so no warning; the monster is not summonable, a material is missing.
    await expect(bande.getByText("Aucune Polymérisation")).toBeHidden();
    await expect(bande.getByText("Invocable avec ce deck")).toBeHidden();
  });

  test("le filtre Extra Deck ne garde que ces monstres, et repère ceux que le deck principal invoque", async ({ page }) => {
    const bande = await ouvrir(page);
    await page.getByRole("group", { name: "Genre de carte" }).getByRole("button", { name: "Extra Deck" }).click();
    const grille = page.getByRole("region", { name: "Collection" }).locator(".grille-collection");
    await expect(grille.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Fusion prête : 0 dans le deck sur 1 possédées, invocable avec le deck principal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fusion partielle : 1 dans le deck sur 1 possédées", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Fusion prête/ }).click();
    await expect(bande).toContainText("2 / 15");
    await expect(bande.getByText("Invocable avec ce deck")).toBeVisible();
  });

  test("le classeur filtre aussi sur l'Extra Deck", async ({ page }) => {
    const { envoyes, envoyer } = await lancer(page, { cartes: { [NIVEAU_7]: carte("Dragon de fusion", MONSTER | FUSION) } });
    await expect.poll(() => envoyes.length).toBeGreaterThan(0);
    envoyer({ type: "collection", cards: [[MONSTRE, 1], [NIVEAU_7, 1]], rarities: [], points: 0 });
    await aller(page, "Collection et decks");
    await page.getByRole("group", { name: "Affichage de la collection" }).getByRole("button", { name: "Classeur" }).click();
    const feuille = page.getByRole("region", { name: "Legend of Blue Eyes White Dragon" });
    const cartesDuSet = feuille.locator(".grille-collection").getByRole("listitem");
    await expect(cartesDuSet).toHaveCount(3);
    await feuille.getByRole("button", { name: "Extra Deck" }).click();
    await expect(cartesDuSet).toHaveCount(1);
    await expect(feuille.getByRole("button", { name: "Dragon de fusion : 1 possédée" })).toBeVisible();
    await feuille.getByRole("button", { name: "Extra Deck" }).click();
    await expect(cartesDuSet).toHaveCount(3);
  });
});

const PRET = 700_000_003;
const ABSENT = 700_000_004;
const MATERIAU_ABSENT = 700_000_005;
const CARTES_DUEL = {
  [POLY]: carte("Polymérisation", SPELL),
  [PRET]: carte("Fusion à invoquer", MONSTER | FUSION, [MONSTRE, NIVEAU_7]),
  [ABSENT]: carte("Fusion sans matériau", MONSTER | FUSION, [MONSTRE, MATERIAU_ABSENT]),
  [MATERIAU_ABSENT]: carte("Matériau absent", MONSTER | OcgType.NORMAL),
};

test("la zone Extra Deck du duel ouvre la liste, met en avant ce qui s'invoque et active Polymérisation", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { duel: true, cartes: CARTES_DUEL, extra: [ABSENT, PRET] });
  await expect(page.getByText("À vous de répondre")).toBeVisible();
  await expect(page.locator(".plateau-3d.est-pret").or(page.getByText("le duel se joue sur le plateau 2D"))).toBeVisible({ timeout: BOARD_READY });

  // Only the player's own Extra Deck opens a list: the opponent's is a count.
  const zone = page.getByRole("button", { name: "Extra Deck : 2 cartes, voir la liste" });
  await expect(page.getByRole("button", { name: /^Extra Deck/ })).toHaveCount(1);
  await zone.click();
  const panneau = page.getByRole("dialog", { name: "Extra Deck" });
  await expect(panneau.getByRole("listitem").filter({ hasText: "Fusion à invoquer" }).first()).toContainText("Matériaux réunis");
  await expect(panneau.getByRole("button", { name: /^Activer/ })).toBeHidden();
  await expect(panneau.getByText("Invocable maintenant")).toBeHidden();
  // The monster whose materials are in the hand comes first.
  await expect(panneau.locator(".extra-liste__ligne").first()).toContainText("Fusion à invoquer");
  await expect(panneau.getByText("Absent", { exact: true })).toBeVisible();

  // The engine now offers Polymerization from the hand.
  envoyer({
    type: "question",
    question: {
      type: OcgMessageType.SELECT_IDLECMD,
      player: 0,
      summons: [],
      special_summons: [],
      pos_changes: [],
      monster_sets: [],
      spell_sets: [],
      activates: [{ code: POLY, controller: 0, location: OcgLocation.HAND, sequence: 2, description: "0", client_mode: 0 }],
      to_bp: false,
      to_ep: true,
      shuffle: false,
    },
    retry: false,
  });
  await expect(panneau.getByText("Invocable maintenant")).toHaveCount(1);
  await panneau.getByRole("button", { name: "Activer Polymérisation" }).click();
  await expect.poll(() => envoyes).toContainEqual({ type: "respond", response: { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 } });
  await expect(panneau).toBeHidden();
});
