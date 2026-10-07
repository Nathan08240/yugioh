import { expect, test } from "@playwright/test";
import { aller, lancer } from "./harnais.ts";

test("le manifeste est servi avec des icônes qui se chargent", async ({ page }) => {
  await lancer(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const reponse = await page.request.get("/manifest.webmanifest");
  const manifeste = await reponse.json();
  expect(manifeste).toMatchObject({ name: "Duel Monsters", display: "standalone", start_url: "/", background_color: "#060817" });
  for (const { src } of manifeste.icons) expect((await page.request.get(src)).ok()).toBe(true);
  expect(manifeste.icons.map((icone: { sizes: string }) => icone.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
});

test("le service worker est enregistré et prend la main sur la page", async ({ page }) => {
  await lancer(page);
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(script).toMatch(/\/sw\.js$/);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});

test("hors connexion, un écran clair remplace la page blanche et le jeu revient avec le réseau", async ({ page, context }) => {
  await lancer(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connexion nécessaire pour jouer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();

  // The offline screen reloads itself on "online", which the emulation does not always send in time: reload until the game is back.
  await context.setOffline(false);
  await expect(async () => {
    await page.reload().catch(() => undefined);
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
});

test("les notifications ne sont demandées qu'au choix « Activées » dans les Paramètres", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    const demande = Notification.requestPermission.bind(Notification);
    (window as unknown as { demandes: number }).demandes = 0;
    Notification.requestPermission = () => {
      (window as unknown as { demandes: number }).demandes++;
      return demande();
    };
  });
  await lancer(page);
  const demandes = () => page.evaluate(() => (window as unknown as { demandes: number }).demandes);
  await aller(page, "Paramètres");
  const groupe = page.getByRole("group", { name: "Notifications" });
  await expect(groupe.getByRole("radio", { name: "Coupées" })).toBeChecked();
  expect(await demandes()).toBe(0);

  // The choice is kept once the browser has answered: no check(), which wants the state changed at once.
  await groupe.getByRole("radio", { name: "Activées" }).click();
  await expect(groupe.getByRole("radio", { name: "Activées" })).toBeChecked();
  expect(await demandes()).toBe(1);

  await page.reload();
  await aller(page, "Paramètres");
  await expect(page.getByRole("group", { name: "Notifications" }).getByRole("radio", { name: "Activées" })).toBeChecked();
});

test("un accord refusé laisse les notifications coupées et explique quoi faire", async ({ page }) => {
  await page.addInitScript(() => {
    Notification.requestPermission = () => Promise.resolve("denied");
  });
  await lancer(page);
  await aller(page, "Paramètres");
  const groupe = page.getByRole("group", { name: "Notifications" });
  await groupe.getByRole("radio", { name: "Activées" }).click({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Notifications refusées" })).toBeVisible();
  await expect(groupe.getByRole("radio", { name: "Coupées" })).toBeChecked();
});

test("le bouton Installer le jeu n'apparaît que lorsque le navigateur propose l'installation", async ({ page }) => {
  await lancer(page);
  await aller(page, "Paramètres");
  await expect(page.getByRole("button", { name: "Installer le jeu" })).toHaveCount(0);

  await page.evaluate(() => {
    const invitation = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(invitation, { prompt: () => ((window as unknown as { installe: boolean }).installe = true) });
    window.dispatchEvent(invitation);
  });
  await page.getByRole("button", { name: "Installer le jeu" }).click();
  expect(await page.evaluate(() => (window as unknown as { installe?: boolean }).installe)).toBe(true);
});
