import { OcgType } from "@n1xx1/ocgcore-wasm";
import type { Page, WebSocketRoute } from "@playwright/test";
import type { CardInfo, ClientMessage, ServerMessage, Wire } from "../../server/src/protocol.ts";
import recorded from "../src/fixtures/duel.json" with { type: "json" };

// The cards of the opening hand of the recorded duel (src/fixtures/duel.json).
export const carte = (name: string, type: number, materials?: number[]): CardInfo => ({ name, alias: 0, desc: "", type, level: 4, attribute: 0, race: 0, atk: 1000, def: 1000, strings: [], attributeName: "", typeLine: "", image: false, ...(materials && { materials }) });
const { MONSTER, NORMAL, SPELL, TRAP } = OcgType;
export const CARTES: Record<number, CardInfo> = {
  90357090: carte("Monstre invocable", MONSTER | NORMAL),
  46986414: carte("Monstre niveau 7", MONSTER | NORMAL),
  55144522: carte("Magie à activer", SPELL),
  50045299: carte("Piège à poser", TRAP),
  6368038: carte("Autre monstre niveau 7", MONSTER | NORMAL),
  12580477: carte("Autre magie", SPELL),
};

// `n` monsters named "Carte factice 0001"... from passcode `depart`, to fill a collection or a deck.
export function cartesFactices(n: number, depart = 1_000_000): Record<number, CardInfo> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [depart + i, carte(`Carte factice ${String(i + 1).padStart(4, "0")}`, MONSTER | NORMAL)]));
}

// The sets of /api/boosters and /api/sets: the first one is the one selected on the boosters screen.
export const SETS = [
  { code: "LOB", name: "Legend of Blue Eyes White Dragon", date: "2002-03-08", cards: [90357090, 46986414, 55144522] },
  { code: "MRD", name: "Metal Raiders", date: "2002-06-26", cards: [50045299, 6368038, 12580477] },
];

// Opens a screen from the main menu (wide screens: the menu is always shown).
export const aller = (page: Page, label: string | RegExp) => page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: label }).click();

// Up to the first SELECT_IDLECMD: the player's hand is dealt, Main Phase 1 of turn 1.
export const DEBUT_DU_DUEL = recorded.received.slice(0, 9);

// A session that supabase-js takes from localStorage as is: not expired, it asks the network for nothing.
const SESSION = {
  access_token: "e2e",
  refresh_token: "e2e",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: { id: "e2e", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

// `cartes`: more cards for /api/cards. `extra`: the player's Extra Deck in the duel.
type Options = { duel?: boolean; cartes?: Record<number, CardInfo>; extra?: number[] };

// Opens the app logged in, against a fake game server that records what the client sends; `duel` replays the recorded duel, animations instant.
export async function lancer(page: Page, { duel = false, cartes = {}, extra }: Options = {}) {
  const envoyes: ClientMessage[] = [];
  let serveur: WebSocketRoute | undefined;
  const envoyer = (msg: Wire<ServerMessage> | object) => serveur?.send(JSON.stringify(msg));
  await page.addInitScript(
    ({ session, instantane }) => {
      localStorage.setItem("sb-supabase-auth-token", JSON.stringify(session));
      if (instantane) localStorage.setItem("yugioh.reglages", JSON.stringify({ vitesse: "instantanee" }));
    },
    { session: SESSION, instantane: duel },
  );
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/cards") return route.fulfill({ json: { ...CARTES, ...cartes } });
    if (path === "/api/strings") return route.fulfill({ json: {} });
    if (path === "/api/starters") return route.fulfill({ json: { yugi: [], kaiba: [] } });
    if (path === "/api/boosters") return route.fulfill({ json: SETS.map(({ code, name, date }) => ({ code, name, date })) });
    if (path === "/api/sets") return route.fulfill({ json: SETS });
    if (path === "/api/craft") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.routeWebSocket("**/ws", (ws) => {
    serveur = ws;
    ws.onMessage((data) => {
      const msg = JSON.parse(String(data)) as ClientMessage;
      envoyes.push(msg);
      if (msg.type !== "auth") return;
      envoyer({ type: "profile", pseudo: "Yugi", needsStarter: false });
      if (!duel) return;
      envoyer({ type: "joined", room: "E2E42", seat: 0, lp: recorded.lp, decks: recorded.decks, extras: [extra?.length ?? 0, 0], extra, opponent: "Kaiba", log: [] });
      for (const message of DEBUT_DU_DUEL) envoyer(message);
    });
  });
  await page.goto("/");
  return { envoyes, envoyer };
}
