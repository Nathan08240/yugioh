// System notifications for a game left open in the background: a friend's challenge, a trade offer, the free booster. Closed, nothing reaches the player (that would take Web Push).
import { useEffect, useRef } from "react";
import type { LobbyState } from "./lobby.ts";
import { reglages } from "./reglages.ts";
import type { Page } from "./Shell.tsx";

// `page`: the screen a click opens.
export type Notif = { tag: string; titre: string; corps: string; page: Page };

export const BOOSTER_PRET: Notif = { tag: "booster-gratuit", titre: "Booster gratuit", corps: "Votre booster gratuit est prêt à être ouvert.", page: "boosters" };

// What a change of the lobby announces: challenges and trade offers that were not there before.
export function choisir(avant: LobbyState, apres: LobbyState): Notif[] {
  const defis = apres.challenges
    .filter(({ from, until }) => !avant.challenges.some((connu) => connu.from === from && connu.until === until))
    .map(({ from }): Notif => ({ tag: `defi-${from}`, titre: "Défi d'un ami", corps: `${from} vous défie en duel.`, page: "amis" }));
  // Offers already there when the list first loads are not news.
  const connues = new Set(avant.trades?.received.map(({ id }) => id));
  const offres = avant.trades ? (apres.trades?.received ?? []).filter(({ id }) => !connues.has(id)) : [];
  return [...defis, ...offres.map(({ id, pseudo }): Notif => ({ tag: `echange-${id}`, titre: "Échange proposé", corps: `${pseudo} vous propose un échange de cartes.`, page: "amis" }))];
}

// Notifications go through the service worker (the only way on Android), which also handles the click.
export const prises = () => "Notification" in globalThis && "serviceWorker" in navigator;

export async function demander(): Promise<boolean> {
  return prises() && (await Notification.requestPermission()) === "granted";
}

// Only while the game is in the background and the player agreed (Settings, then the browser).
function montrer({ tag, titre, corps, page }: Notif) {
  if (!document.hidden || reglages().notifications !== "oui" || !prises() || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then((registration) => registration.showNotification(titre, { body: corps, tag, icon: "/icones/icone-192.png", data: { page } }));
}

// `go` opens the screen of a notification clicked (message of public/sw.js).
export function useNotifications(state: LobbyState, go: (page: Page) => void) {
  const precedent = useRef(state);
  useEffect(() => {
    for (const notif of choisir(precedent.current, state)) montrer(notif);
    precedent.current = state;
  }, [state]);

  // The free booster falls due while the player is elsewhere.
  const prochain = state.boosters?.nextFreeAt;
  useEffect(() => {
    const delai = prochain ? Date.parse(prochain) - Date.now() : 0;
    if (delai <= 0) return;
    const id = setTimeout(() => montrer(BOOSTER_PRET), delai);
    return () => clearTimeout(id);
  }, [prochain]);

  useEffect(() => {
    const worker = navigator.serviceWorker;
    const ouvrir = ({ data }: MessageEvent) => {
      if (data?.type === "ouvrir") go(data.page);
    };
    worker?.addEventListener("message", ouvrir);
    return () => worker?.removeEventListener("message", ouvrir);
  }, [go]);
}
