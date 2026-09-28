import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgPosition, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { runDuel, STARTING_LP, type Player, type Seed } from "../src/duel.ts";
import type { ClientMessage, Seat, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer, type Accounts } from "../src/server.ts";
import { hideCards, visibleTo } from "../src/visibility.ts";

const seeds: Seed[] = Array.from({ length: 40 }, (_, i) => [BigInt(i + 1), 2n, 3n, 4n]);
const firstOption: Player = (question) => respond(question);

function bot(seat: Seat): Player {
  const player = new Bot(seat, STARTING_LP, [YUGI.length, KAIBA.length], 0);
  return (question, log) => player.answer(question, log);
}

describe("bot", () => {
  it("joue contre lui-même jusqu'à la victoire sur 40 seeds, sans réponse refusée ni repli", { timeout: 120_000 }, async () => {
    const errors = vi.spyOn(console, "error");
    for (const seed of seeds) {
      const state = await runDuel(seed, 500, [bot(0), bot(1)]);
      expect(state.winner, `seed ${seed[0]}`).not.toBeNull();
      expect(state.errors).toEqual([]);
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("bat nettement le répondeur « première option valide », avec les deux decks", { timeout: 120_000 }, async () => {
    let wins = 0;
    for (const seed of seeds) {
      wins += Number((await runDuel(seed, 500, [bot(0), firstOption])).winner === 0);
      wins += Number((await runDuel(seed, 500, [firstOption, bot(1)])).winner === 1);
    }
    console.log(`bot contre première option : ${wins} victoires sur ${seeds.length * 2} duels`);
    expect(wins / (seeds.length * 2)).toBeGreaterThan(0.65);
  });

  it("joue un duel complet dans une salle contre un humain, sans recevoir d'information cachée", { timeout: 30_000 }, async () => {
    const accounts: Accounts = {
      verify: async (token) => token,
      findProfile: async (userId) => ({ userId, pseudo: userId }),
      createProfile: async () => undefined,
      storyProgress: async () => new Set(),
      completeStory: async () => undefined,
    };
    const wss = startServer(0, accounts, () => [5n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const answer = vi.spyOn(Bot.prototype, "answer");

    const socket = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`);
    const received: Wire<ServerMessage>[] = [];
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    socket.on("message", (data) => {
      const msg: Wire<ServerMessage> = JSON.parse(String(data));
      received.push(msg);
      // respond() reads no bigint field for the questions of these decks, so the wire form works as is.
      if (msg.type === "question") send({ type: "respond", response: respond(msg.question as unknown as OcgMessage) });
    });
    await once(socket, "open");
    send({ type: "auth", token: "alice" });
    send({ type: "bot" });
    const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.WIN })), { timeout: 25_000 });
    socket.close();

    expect(received).toContainEqual(expect.objectContaining({ type: "joined", seat: 0 }));
    for (const msg of received) if (msg.type === "question") expect(msg.question).toMatchObject({ player: 0 });
    expect(answer).toHaveBeenCalled();
    const log = answer.mock.lastCall?.[1] ?? [];
    // Everything the bot got had already gone through the filter of its seat.
    expect(log.map((msg) => visibleTo(msg, 1))).toEqual(log);
    for (const [question] of answer.mock.calls) expect(hideCards(question, 1)).toEqual(question);
    const drawn = log.flatMap((msg) => (msg.type === OcgMessageType.DRAW && msg.player === 0 ? msg.drawn : []));
    const hidden = drawn.filter((card) => (card.position & OcgPosition.FACEUP) === 0);
    expect(hidden.length).toBeGreaterThan(5);
    expect(hidden.filter((card) => card.code !== 0)).toEqual([]);
    answer.mockRestore();
  });
});
