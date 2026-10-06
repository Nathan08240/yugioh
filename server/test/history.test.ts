import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { replayAllowed, REPLAYS_LIMITED, REPLAYS_PER_MINUTE, type HistoryEntry } from "../src/history.ts";
import { PUZZLE_FAILED, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";
import { pass } from "./solver.ts";

type Received = Wire<ServerMessage>;

const saved: (HistoryEntry & { id: number })[] = [];
const wss = startServer(
  0,
  fakeAccounts({
    saveReplay: async (entry) => {
      saved.push({ ...JSON.parse(JSON.stringify(entry)), id: saved.length + 1 });
    },
    replays: async (userId) => saved.filter((entry) => entry.userId === userId).map(({ id, mode, opponent, won }) => ({ id, date: "2026-10-02T12:00:00.000Z", mode, opponent, won })),
    readReplay: async (userId, id) => saved.find((entry) => entry.userId === userId && entry.id === id),
  }),
  () => [1n, 2n, 3n, 4n],
  0,
);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A player who answers the first `limit` questions with `answer` (the first option), then waits.
async function player(user: string, limit = Infinity, answer: (question: OcgMessage) => OcgResponse = (question) => respond(question)) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  let answers = 0;
  socket.on("message", (data) => {
    const msg: Received = JSON.parse(String(data));
    received.push(msg);
    if (msg.type !== "question" || answers >= limit) return;
    answers++;
    socket.send(JSON.stringify({ type: "respond", response: answer(msg.question as unknown as OcgMessage) } satisfies ClientMessage));
  });
  await once(socket, "open");
  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  send({ type: "auth", token: user });
  const batches = () => received.flatMap((msg) => (msg.type === "messages" ? [msg.messages] : []));
  // The last message of that type.
  const find = <T extends Received["type"]>(type: T) => received.findLast((msg): msg is Extract<Received, { type: T }> => msg.type === type);
  return { send, received, batches, find, answers: () => answers };
}

const isWin = (msg: { type: unknown }) => msg.type === OcgMessageType.WIN;

describe("revoir ses derniers duels", () => {
  it("un duel abandonné puis rejoué redonne ce que le joueur a vu, jusqu'à la même fin", { timeout: 30_000 }, async () => {
    const alice = await player("alice", 8);
    alice.send({ type: "bot" });
    await vi.waitFor(() => expect(alice.answers()).toBe(8), { timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    alice.send({ type: "surrender" });
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ userId: "alice", seat: 0, mode: "bot", opponent: "Bot", won: false, replay: { end: { winner: 1, reason: 0 } } });

    alice.send({ type: "replays" });
    await vi.waitFor(() => expect(alice.find("replays")?.replays).toEqual([{ id: 1, date: "2026-10-02T12:00:00.000Z", mode: "bot", opponent: "Bot", won: false }]));
    alice.send({ type: "replay", id: 1 });
    await vi.waitFor(() => expect(alice.find("replay")).toBeDefined(), { timeout: 20_000 });
    const replay = alice.find("replay");
    const joined = alice.find("joined");
    expect(replay).toMatchObject({ id: 1, seat: 0, lp: joined?.lp, decks: joined?.decks, extras: joined?.extras, opponent: "Bot" });
    expect(replay?.batches).toEqual(alice.batches());
    expect(replay?.batches.flat().filter(isWin)).toEqual([{ type: OcgMessageType.WIN, player: 1, reason: 0 }]);
  });

  it("un duel mené jusqu'au bout se rejoue jusqu'au même WIN du moteur, sans rien de caché qui n'était visible", { timeout: 60_000 }, async () => {
    const bob = await player("bob");
    bob.send({ type: "bot" });
    await vi.waitFor(() => expect(saved.some((entry) => entry.userId === "bob")).toBe(true), { timeout: 50_000 });
    const entry = saved.find((candidate) => candidate.userId === "bob");
    bob.send({ type: "replay", id: entry?.id ?? 0 });
    await vi.waitFor(() => expect(bob.find("replay")).toBeDefined(), { timeout: 20_000 });
    const batches = bob.find("replay")?.batches ?? [];
    expect(batches).toEqual(bob.batches());
    expect(batches.flat().filter(isWin)).toHaveLength(1);
    expect(batches.flat().some((msg) => msg.type === OcgMessageType.NEW_TURN)).toBe(true);
  });

  it("un puzzle échoué au tour limite se rejoue sans le tour suivant, avec son placement de départ", { timeout: 30_000 }, async () => {
    const joey = await player("joey", Infinity, (question) => pass(question, []));
    joey.send({ type: "puzzle", id: "coup-de-grace" });
    await vi.waitFor(() => expect(saved.some((entry) => entry.userId === "joey")).toBe(true), { timeout: 20_000 });
    const entry = saved.find((candidate) => candidate.userId === "joey");
    expect(entry).toMatchObject({ mode: "puzzle", won: false });
    joey.send({ type: "replay", id: entry?.id ?? 0 });
    await vi.waitFor(() => expect(joey.find("replay")).toBeDefined(), { timeout: 20_000 });
    const batches = joey.find("replay")?.batches ?? [];
    expect(batches).toEqual(joey.batches());
    expect(batches.flat().filter(isWin)).toEqual([{ type: OcgMessageType.WIN, player: 1, reason: PUZZLE_FAILED }]);
  });

  it("ne rejoue que les duels du joueur", async () => {
    const eve = await player("eve", 0);
    eve.send({ type: "replay", id: 1 });
    await vi.waitFor(() => expect(eve.received).toContainEqual({ type: "error", error: "duel introuvable" }));
    expect(eve.find("replay")).toBeUndefined();
  });

  it(`limite à ${REPLAYS_PER_MINUTE} les duels revus par minute`, async () => {
    const zoe = await player("zoe", 0);
    for (let i = 0; i <= REPLAYS_PER_MINUTE; i++) zoe.send({ type: "replay", id: 1 });
    await vi.waitFor(() => expect(zoe.received.filter((msg) => msg.type === "error")).toHaveLength(REPLAYS_PER_MINUTE + 1));
    expect(zoe.received.at(-1)).toEqual({ type: "error", error: REPLAYS_LIMITED });
    expect(replayAllowed(new Map([["zoe", [0]]]), "zoe", 60_000)).toBe(true);
  });
});
