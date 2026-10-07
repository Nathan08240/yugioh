// The game as an installable app: service worker (public/sw.js), update offer and install prompt.
import { useSyncExternalStore } from "react";

type Invitation = Event & { prompt: () => Promise<unknown> };
type Etat = { installable: boolean; miseAJour: boolean };

let etat: Etat = { installable: false, miseAJour: false };
let invitation: Invitation | undefined;
// The player accepted the update: the new worker taking control reloads the page, and only then.
let demandee = false;
const abonnes = new Set<() => void>();

function changer(suite: Partial<Etat>) {
  etat = { ...etat, ...suite };
  for (const abonne of abonnes) abonne();
}

const abonner = (rappel: () => void) => {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
};

const lire = () => etat;
export const usePwa = () => useSyncExternalStore(abonner, lire, lire);

export function enregistrer() {
  // The browser offers the install only to a page it finds installable: the prompt waits for the Settings button.
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    invitation = event as Invitation;
    changer({ installable: true });
  });
  addEventListener("appinstalled", () => {
    invitation = undefined;
    changer({ installable: false });
  });
  const { serviceWorker } = navigator;
  if (!serviceWorker) return;
  // A new worker waiting while another one controls the page is an update (the very first install is not).
  const proposer = (worker: ServiceWorker) => {
    if (worker.state === "installed" && serviceWorker.controller) changer({ miseAJour: true });
  };
  serviceWorker.register("/sw.js").then((registration) => {
    if (registration.waiting) proposer(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => proposer(worker));
    });
    // A game left open for days looks for a new version when the player comes back.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) registration.update().catch(() => {});
    });
  });
  serviceWorker.addEventListener("controllerchange", () => {
    if (demandee) location.reload();
  });
}

export function installer() {
  invitation?.prompt();
}

export function mettreAJour() {
  demandee = true;
  navigator.serviceWorker.getRegistration().then((registration) => registration?.waiting?.postMessage("activer"));
}
