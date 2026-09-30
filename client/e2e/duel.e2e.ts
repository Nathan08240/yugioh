import { OcgLocation, OcgMessageType, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";
import { expect, test, type Page } from "@playwright/test";
import { lancer } from "./harnais.ts";

// The duel is waiting for the player: every animation has played, the first question is shown.
async function aLaMain(page: Page) {
  await expect(page.getByText("À vous de répondre")).toBeVisible();
  return page.getByRole("region", { name: "Votre main" });
}

test("un duel s'affiche avec le plateau, la main et les plaques", async ({ page }) => {
  await lancer(page, { duel: true });
  const main = await aLaMain(page);
  await expect(page.locator(".plateau-3d.est-pret").or(page.getByText("le duel se joue sur le plateau 2D"))).toBeVisible();
  await expect(main.getByRole("button")).toHaveCount(6);
  await expect(main.getByRole("button", { name: "Monstre invocable, jouable" })).toBeVisible();
  await expect(page.getByText("Vos points de vie : 4000 sur 4000")).toBeAttached();
  await expect(page.getByText("Points de vie de l'adversaire : 4000 sur 4000")).toBeAttached();
  await expect(page.locator(".plaque--moi")).toContainText("Yugi");
  await expect(page.locator(".plaque--adverse")).toContainText("Kaiba");
});

test("un clic sur une carte jouable ouvre ses actions, Échap les ferme", async ({ page }) => {
  await lancer(page, { duel: true });
  const main = await aLaMain(page);
  await main.getByRole("button", { name: "Monstre invocable, jouable" }).click();
  const bulle = page.getByRole("dialog", { name: "Actions : Monstre invocable" });
  await expect(bulle.getByRole("button")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(bulle).toBeHidden();
});

test("glisser une carte sur une zone envoie l'action puis la zone au serveur", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { duel: true });
  const main = await aLaMain(page);
  // The 2D board has no drag and drop (Duel.tsx).
  await expect(page.locator(".plateau-3d.est-pret").or(page.getByText("le duel se joue sur le plateau 2D"))).toBeVisible();
  test.skip(!(await page.locator(".plateau-3d").isVisible()), "WebGL 2 indisponible dans ce navigateur : pas de plateau 3D");

  const carte = await main.getByRole("button", { name: "Piège à poser, jouable" }).boundingBox();
  if (!carte) throw new Error("carte hors écran");
  await page.mouse.move(carte.x + carte.width / 2, carte.y + carte.height / 2);
  await page.mouse.down();
  await page.mouse.move(carte.x + carte.width / 2, carte.y - 30, { steps: 5 });
  const zone = await page.getByRole("button", { name: "Choisir : Zone Magie/Piège 3", exact: true }).boundingBox();
  if (!zone) throw new Error("zone hors écran");
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 10 });
  await page.mouse.up();

  // Piège à poser is spell_sets[1] of the recorded SELECT_IDLECMD.
  await expect.poll(() => envoyes).toContainEqual({ type: "respond", response: { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: 1 } });
  // The engine then asks for the zone: the drop answers it, Spell/Trap zone 3 is sequence 2.
  envoyer({ type: "question", question: { type: OcgMessageType.SELECT_PLACE, player: 0, count: 1, field_mask: 4_294_959_359 }, retry: false });
  await expect.poll(() => envoyes).toContainEqual({ type: "respond", response: { type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: OcgLocation.SZONE, sequence: 2 }] } });
});

test("l'écran de fin donne la cause : abandon", async ({ page }) => {
  const { envoyes, envoyer } = await lancer(page, { duel: true });
  await aLaMain(page);
  await page.getByRole("button", { name: "Abandonner" }).click();
  await page.getByRole("alertdialog", { name: "Confirmation" }).getByRole("button", { name: "Abandonner" }).click();
  await expect.poll(() => envoyes).toContainEqual({ type: "surrender" });
  // What the server answers a surrender: the WIN of the other seat, reason 0.
  envoyer({ type: "messages", messages: [{ type: OcgMessageType.WIN, player: 1, reason: 0 }] });
  const fin = page.getByRole("region", { name: "Défaite" });
  await expect(fin).toBeVisible();
  await expect(fin.getByText("Vous avez abandonné.")).toBeVisible();
});
