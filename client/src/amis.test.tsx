import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Friend } from "../../server/src/protocol.ts";
import { AlertesView, AmisView } from "./Amis.tsx";
import { DuelView } from "./cards.ts";
import { initialLobby, reduce } from "./lobby.ts";

const friends: Friend[] = [
  { pseudo: "Joey", avatar: null, status: "online" },
  { pseudo: "Kaiba", avatar: null, status: "duel" },
  { pseudo: "Mai", avatar: null, status: "offline" },
  { pseudo: "Tea", avatar: null, status: "received" },
  { pseudo: "Tristan", avatar: null, status: "sent" },
];
const render = (node: ReactNode) => renderToStaticMarkup(<DuelView value={{ cards: new Map(), show: () => {}, seat: 0 }}>{node}</DuelView>);

it("suit la liste, les statuts, les défis reçus et les notifications envoyés par le serveur", () => {
  let state = reduce(initialLobby, { type: "friends", friends });
  state = reduce(state, { type: "friend_status", pseudo: "Mai", status: "online" });
  expect(state.friends?.find((friend) => friend.pseudo === "Mai")?.status).toBe("online");
  state = reduce(state, { type: "challenged", from: "Joey", ms: 60_000 });
  state = reduce(state, { type: "challenged", from: "Joey", ms: 60_000 });
  state = reduce(state, { type: "challenged", from: "Mai", ms: 60_000 });
  expect(state.challenges.map((challenge) => challenge.from)).toEqual(["Joey", "Mai"]);
  state = reduce(state, { type: "challenge_gone", from: "Joey" });
  expect(state.challenges.map((challenge) => challenge.from)).toEqual(["Mai"]);
  state = reduce(reduce(state, { type: "friend_notice", text: "a" }), { type: "friend_notice", text: "a" });
  expect(state.notice).toEqual({ text: "a", n: 2 });
});

it("classe demandes reçues, amis et demandes envoyées, avec Défier pour un ami en ligne seulement", () => {
  const html = render(<AmisView friends={friends} send={() => {}} />);
  expect(html).toMatch(/Demandes reçues[^]*Tea[^]*Accepter[^]*Refuser[^]*Mes amis[^]*Joey[^]*Kaiba[^]*Mai[^]*Demandes envoyées[^]*Tristan[^]*Annuler/);
  expect(html.match(/Défier/g)).toHaveLength(1);
  expect(html).toContain("En ligne");
  expect(html).toContain("En duel");
  expect(html).toContain("Hors ligne");
  expect(html).toContain("5 / 100");
});

it("affiche un défi avec son temps restant tant qu'il n'a pas expiré", () => {
  const now = 1_000_000;
  const html = render(<AlertesView challenges={[{ from: "Joey", until: now + 42_000 }, { from: "Mai", until: now - 1 }]} send={() => {}} now={now} />);
  expect(html).toContain("Joey");
  expect(html).toContain("0:42");
  expect(html).not.toContain("Mai");
  expect(render(<AlertesView challenges={[]} send={() => {}} now={now} />)).toBe("");
});
