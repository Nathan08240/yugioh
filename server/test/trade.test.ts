import { expect, it } from "vitest";
import type { ServerMessage } from "../src/protocol.ts";
import { tradeReply, validTradeMessage, type TradeStore } from "../src/trade.ts";
import { noTrades } from "./fakes.ts";

const alice = { id: "a", pseudo: "Alice" };

function run(store: Partial<TradeStore>) {
  const sent: [string, ServerMessage][] = [];
  const reply = (msg: Parameters<typeof tradeReply>[2]) => tradeReply({ ...noTrades, ...store }, alice, msg, (id, message) => sent.push([id, message]));
  return { sent, reply };
}

it("vérifie la forme des messages d'échange", () => {
  expect(validTradeMessage({ type: "trades" })).toBe(true);
  expect(validTradeMessage({ type: "trade_cards", pseudo: "Bob" })).toBe(true);
  expect(validTradeMessage({ type: "trade_cards", pseudo: 3 })).toBe(false);
  expect(validTradeMessage({ type: "trade_offer", pseudo: "Bob", give: 1, get: 2 })).toBe(true);
  expect(validTradeMessage({ type: "trade_offer", pseudo: "Bob", give: 1.5, get: 2 })).toBe(false);
  expect(validTradeMessage({ type: "trade_accept", id: 4 })).toBe(true);
  expect(validTradeMessage({ type: "trade_remove", id: "4" })).toBe(false);
  expect(validTradeMessage({ type: "friends" })).toBe(false);
});

it("une offre met à jour les deux listes et prévient l'ami ; une erreur ne prévient personne", async () => {
  const { sent, reply } = run({ offerTrade: async () => ({ to: "b" }) });
  expect(await reply({ type: "trade_offer", pseudo: "Bob", give: 1, get: 2 })).toBeUndefined();
  expect(sent.map(([id, msg]) => [id, msg.type])).toEqual([
    ["a", "friend_notice"],
    ["a", "trades"],
    ["b", "trades"],
    ["b", "friend_notice"],
  ]);
  expect(sent[3][1]).toEqual({ type: "friend_notice", text: "Alice vous propose un échange de cartes." });
  const failed = run({});
  expect(await failed.reply({ type: "trade_offer", pseudo: "Bob", give: 1, get: 2 })).toBe("ami introuvable");
  expect(failed.sent).toEqual([]);
});

it("accepter, refuser ou annuler prévient l'autre joueur selon le cas", async () => {
  const accepted = run({ acceptTrade: async () => ({ from: "b" }) });
  await accepted.reply({ type: "trade_accept", id: 1 });
  expect(accepted.sent.at(-1)).toEqual(["b", { type: "friend_notice", text: "Alice a accepté votre échange de cartes." }]);
  const refused = run({ removeTrade: async () => ({ other: "b", refused: true }) });
  await refused.reply({ type: "trade_remove", id: 1 });
  expect(refused.sent.at(-1)).toEqual(["b", { type: "friend_notice", text: "Alice a refusé votre échange de cartes." }]);
  const cancelled = run({ removeTrade: async () => ({ other: "b", refused: false }) });
  await cancelled.reply({ type: "trade_remove", id: 1 });
  expect(cancelled.sent.map(([id, msg]) => [id, msg.type])).toEqual([
    ["a", "trades"],
    ["b", "trades"],
  ]);
  expect(await run({}).reply({ type: "trade_remove", id: 1 })).toBe("offre expirée ou déjà traitée");
});

it("envoie les cartes échangeables avec le pseudo demandé", async () => {
  const { sent, reply } = run({ tradeCards: async () => ({ mine: [[1, 1]], theirs: [[2, 3]] }) });
  await reply({ type: "trade_cards", pseudo: "Bob" });
  expect(sent).toEqual([["a", { type: "trade_cards", pseudo: "Bob", mine: [[1, 1]], theirs: [[2, 3]] }]]);
});
