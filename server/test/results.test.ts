import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgProcessResult, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { YUGI } from "../src/decks.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import type { DuelResult } from "../src/results.ts";
import { advance, startServer, type Room } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

type Received = Wire<ServerMessage>;

// Token = user id. Every user plays stored deck 7; `results` is what the server reads back.
async function setup(results: Wire<ServerMessage> & { type: "duel_results" } = { type: "duel_results", results: [] }) {
  const recorded: DuelResult[] = [];
  const accounts = fakeAccounts({
    activeDeck: async () => ({ main: YUGI, extra: [], id: 7 }),
    recordResult: async (result) => void recorded.push(result),
    duelResults: async () => results.results,
  });
  const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
  onTestFinished(() => wss.close());
  await once(wss, "listening");
  const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;

  async function connect(user: string) {
    const socket = new WebSocket(url);
    const received: Received[] = [];
    socket.on("message", (data) => {
      const msg: Received = JSON.parse(String(data));
      received.push(msg);
      const response = msg.type === "question" ? respond(msg.question as unknown as OcgMessage) : undefined;
      if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
    });
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    const won = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : [])).filter((msg) => msg.type === OcgMessageType.WIN);
    return { received, send, won };
  }
  return { recorded, connect };
}

// A duel where the seat that asked first surrenders, once the engine has asked its first question.
const started = (clients: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["connect"]>>[]) =>
  vi.waitFor(() => expect(clients.some((client) => client.received.some((msg) => msg.type === "question"))).toBe(true), { timeout: 20_000 });

describe("résultats des duels", () => {
  it("un duel en ligne enregistre un résultat par joueur, une seule fois, abandon compris", { timeout: 30_000 }, async () => {
    const { recorded, connect } = await setup();
    const a = await connect("res-a");
    a.send({ type: "create" });
    await vi.waitFor(() => expect(a.received.find((msg) => msg.type === "joined")).toBeDefined());
    const b = await connect("res-b");
    b.send({ type: "join", room: (a.received.find((msg) => msg.type === "joined") as { room: string }).room });
    await started([a, b]);

    a.send({ type: "surrender" });
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    b.send({ type: "surrender" });
    await vi.waitFor(() => expect(b.received).toContainEqual({ type: "error", error: "aucun duel en cours" }));

    expect(recorded).toEqual([
      { userId: "res-a", deckId: 7, mode: "online", won: false, reason: 0, turns: expect.any(Number) },
      { userId: "res-b", deckId: 7, mode: "online", won: true, reason: 0, turns: expect.any(Number) },
    ]);
  });

  it("un duel contre le bot n'enregistre que le joueur, avec le niveau du bot, et la revanche est un nouveau duel", { timeout: 30_000 }, async () => {
    const { recorded, connect } = await setup();
    const human = await connect("res-bot");
    human.send({ type: "bot", level: "expert" });
    await started([human]);
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]).toEqual({ userId: "res-bot", deckId: 7, mode: "bot", level: "expert", won: false, reason: 0, turns: expect.any(Number) });

    human.send({ type: "rematch" });
    await vi.waitFor(() => expect(human.received.filter((msg) => msg.type === "joined")).toHaveLength(2));
    await vi.waitFor(() => expect(human.received.filter((msg) => msg.type === "question").length).toBeGreaterThan(1));
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
  });

  it("un duel d'histoire enregistre le niveau choisi", { timeout: 30_000 }, async () => {
    const { recorded, connect } = await setup();
    const human = await connect("res-story");
    human.send({ type: "story_duel", duel: "dk-weevil", level: "facile" });
    await started([human]);
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]).toMatchObject({ userId: "res-story", mode: "story", level: "facile", won: false });
  });

  it("renvoie les résultats du joueur avec duel_results", async () => {
    const results = { type: "duel_results" as const, results: [{ deck: 7, mode: "bot" as const, wins: 2, losses: 1 }] };
    const { connect } = await setup(results);
    const human = await connect("res-lire");
    human.send({ type: "duel_results" });
    await vi.waitFor(() => expect(human.received).toContainEqual(results));
  });

  it("advance() compte les tours et signale la fin à room.onEnd avec la raison du moteur", () => {
    const socket = () => ({ send: vi.fn() }) as unknown as WebSocket;
    const messages = [{ type: OcgMessageType.NEW_TURN, player: 0 }, { type: OcgMessageType.NEW_TURN, player: 1 }, { type: OcgMessageType.WIN, player: 1, reason: 2 }] as unknown as OcgMessage[];
    const duel = { lib: { duelProcess: () => OcgProcessResult.END, duelGetMessage: () => messages, duelQueryLocation: () => [], destroyDuel: vi.fn() }, handle: 1 } as unknown as NonNullable<Room["duel"]>;
    const onEnd = vi.fn();
    const room: Room = { code: "FIN", players: [{ id: "p0", socket: socket(), log: [], deck: [] }, { id: "p1", socket: socket(), log: [], deck: [] }], duel, onEnd };

    advance(room);

    expect(onEnd).toHaveBeenCalledWith(1, 2);
    expect(room.turns).toBe(2);
  });
});
