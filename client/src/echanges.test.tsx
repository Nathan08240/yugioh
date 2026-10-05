import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { AmisView } from "./Amis.tsx";
import { DuelView } from "./cards.ts";
import { Echanges, Proposition } from "./Echanges.tsx";
import { initialLobby, reduce } from "./lobby.ts";

const card = (name: string) => ({ name }) as CardInfo;
const cards = new Map([
  [1, card("Kuriboh")],
  [2, card("Dragon Blanc aux Yeux Bleus")],
  [3, card("Magicien Sombre")],
]);
const render = (node: ReactNode) => renderToStaticMarkup(<DuelView value={{ cards, show: () => {}, seat: 0 }}>{node}</DuelView>);
const now = Date.parse("2026-10-02T10:00:00Z");
const offer = (id: number, pseudo: string) => ({ id, pseudo, give: 1, get: 2, expiresAt: "2026-10-02T15:30:00Z" });

it("garde les offres et les doublons envoyés par le serveur", () => {
  let state = reduce(initialLobby, { type: "trades", received: [offer(1, "Joey")], sent: [], left: 2 });
  state = reduce(state, { type: "trade_cards", pseudo: "Joey", mine: [[1, 1]], theirs: [[2, 1]] });
  expect(state.trades?.received).toHaveLength(1);
  expect(state.tradeCards?.theirs).toEqual([[2, 1]]);
});

it("liste les offres reçues et envoyées, sans accepter une fois la limite du jour atteinte", () => {
  const html = render(<Echanges trades={{ type: "trades", received: [offer(1, "Joey")], sent: [offer(2, "Mai")], left: 0 }} send={() => {}} now={now} />);
  expect(html).toMatch(/0 \/ 3 restants[^]*Offres reçues[^]*Joey[^]*expire dans 6 h[^]*Vous donnez[^]*Kuriboh[^]*Vous recevez[^]*Dragon Blanc[^]*Accepter[^]*Refuser[^]*Offres envoyées[^]*Mai[^]*Annuler/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Accepter/);
  expect(render(<Echanges trades={{ type: "trades", received: [], sent: [], left: 3 }} send={() => {}} />)).toBe("");
});

it("propose ses doublons et ceux de l'ami, ses souhaits en tête", () => {
  const tradeCards = { type: "trade_cards" as const, pseudo: "Joey", mine: [[1, 2]] as [number, number][], theirs: [[2, 1], [3, 1]] as [number, number][] };
  const html = render(<Proposition pseudo="Joey" tradeCards={tradeCards} wishlist={[3]} send={() => {}} close={() => {}} />);
  expect(html).toMatch(/Vous donnez[^]*Kuriboh[^]*2 à échanger[^]*Vous recevez de Joey[^]*Magicien Sombre[^]*Souhaitée[^]*Dragon Blanc/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Proposer l&#x27;échange/);
  expect(render(<Proposition pseudo="Mai" tradeCards={tradeCards} send={() => {}} close={() => {}} />)).toContain("Chargement des doublons");
});

it("offre un échange à chaque ami accepté", () => {
  const html = render(<AmisView friends={[{ pseudo: "Joey", avatar: null, status: "offline" }, { pseudo: "Tea", avatar: null, status: "received" }]} send={() => {}} />);
  expect(html.match(/Proposer un échange/g)).toHaveLength(1);
});
