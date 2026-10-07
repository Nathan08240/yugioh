import { expect, it } from "vitest";
import { initialLobby, type LobbyState } from "./lobby.ts";
import { choisir } from "./notifications.ts";

const offre = (id: number, pseudo = "Joey") => ({ id, pseudo, give: 1, get: 2, expiresAt: "2026-10-08T00:00:00Z" });
const trades = (...received: ReturnType<typeof offre>[]): LobbyState["trades"] => ({ type: "trades", received, sent: [], left: 3 });
const avec = (suite: Partial<LobbyState>): LobbyState => ({ ...initialLobby, ...suite });

it("annonce un défi reçu, une seule fois", () => {
  const defi = { from: "Joey", until: 1000 };
  expect(choisir(initialLobby, avec({ challenges: [defi] }))).toEqual([{ tag: "defi-Joey", titre: "Défi d'un ami", corps: "Joey vous défie en duel.", page: "amis" }]);
  expect(choisir(avec({ challenges: [defi] }), avec({ challenges: [defi] }))).toEqual([]);
  // The same friend challenging again is a new challenge.
  expect(choisir(avec({ challenges: [defi] }), avec({ challenges: [{ from: "Joey", until: 2000 }] }))).toHaveLength(1);
  // A challenge that goes away announces nothing.
  expect(choisir(avec({ challenges: [defi] }), initialLobby)).toEqual([]);
});

it("annonce un échange proposé, pas ceux déjà connus", () => {
  expect(choisir(avec({ trades: trades(offre(1)) }), avec({ trades: trades(offre(1), offre(2, "Tea")) }))).toEqual([
    { tag: "echange-2", titre: "Échange proposé", corps: "Tea vous propose un échange de cartes.", page: "amis" },
  ]);
  expect(choisir(avec({ trades: trades(offre(1)) }), avec({ trades: trades() }))).toEqual([]);
});

it("ne prend pas la première liste d'échanges reçue pour une nouveauté", () => {
  expect(choisir(initialLobby, avec({ trades: trades(offre(1), offre(2)) }))).toEqual([]);
});
