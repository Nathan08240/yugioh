import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { KAIBA, YUGI } from "../src/decks.ts";
import { REPORT_MAX, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import { replay, type Report } from "../src/report.ts";
import { respond } from "../src/respond.ts";
import { ANSWERS, startServer, type Accounts } from "../src/server.ts";
import { visibleTo } from "../src/visibility.ts";
import { fakeAccounts } from "./fakes.ts";

type Received = Wire<ServerMessage>;

const saved: { userId: string; message: string; report: Report }[] = [];
let allowed = true;
const accounts: Accounts = fakeAccounts({
  verify: async (token) => token,
  saveReport: async (userId, message, report) => {
    if (allowed) saved.push({ userId, message, report });
    return allowed;
  },
});
const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A player who answers the first `limit` questions with the first option, then waits.
async function player(user: string, limit = Infinity, answer: (question: OcgMessage, retry: boolean) => OcgResponse = (question) => respond(question)) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  let answers = 0;
  socket.on("message", (data) => {
    const msg: Received = JSON.parse(String(data));
    received.push(msg);
    if (msg.type !== "question" || answers >= limit) return;
    answers++;
    socket.send(JSON.stringify({ type: "respond", response: answer(msg.question as unknown as OcgMessage, msg.retry) } satisfies ClientMessage));
  });
  await once(socket, "open");
  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  send({ type: "auth", token: user });
  const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
  return { send, received, messages, answers: () => answers };
}

const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? String(v) : v)));

describe("signalement d'un problème", () => {
  it("enregistre de quoi rejouer le duel, et le rejeu donne les mêmes messages", { timeout: 30_000 }, async () => {
    const alice = await player("alice", 8);
    alice.send({ type: "bot" });
    await vi.waitFor(() => expect(alice.answers()).toBe(8), { timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const count = alice.messages().length;
    alice.send({ type: "report", message: "  Trou Noir  " });
    await vi.waitFor(() => expect(alice.received).toContainEqual({ type: "report_sent" }));
    expect(alice.messages()).toHaveLength(count);

    const { userId, message, report } = saved.at(-1) as (typeof saved)[number];
    const room = alice.received.find((msg) => msg.type === "joined")?.room;
    expect({ userId, message }).toEqual({ userId: "alice", message: "Trou Noir" });
    expect(report).toMatchObject({ mode: "bot", room, seed: ["1", "2", "3", "4"], decks: [{ main: YUGI, extra: [] }, { main: KAIBA, extra: [] }] });
    expect(report.rules).toEqual({ lp: 4000, hand: 5, cards: [] });
    expect(report.turn).toBeGreaterThan(0);
    expect(report.responses.length).toBeGreaterThanOrEqual(8);

    // Same seed, decks and responses: the engine says what the player was told (questions aside).
    const replayed = await replay(JSON.parse(JSON.stringify(report)));
    const seen = replayed.filter((msg) => !ANSWERS.has(msg.type)).flatMap((msg) => visibleTo(msg, 0) ?? []);
    const expected = alice.messages().filter((msg) => msg.type !== "stats");
    expect(expected.length).toBeGreaterThan(10);
    expect(wire(seen.slice(0, expected.length))).toEqual(expected);
  });

  it("ne garde pas la réponse que le moteur a refusée", { timeout: 30_000 }, async () => {
    let refused = false;
    const dave = await player("dave", 8, (question, retry) => {
      if (refused || retry || question.type !== OcgMessageType.SELECT_IDLECMD) return respond(question);
      refused = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 99 };
    });
    dave.send({ type: "bot" });
    await vi.waitFor(() => expect(dave.answers()).toBe(8), { timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    dave.send({ type: "report" });
    await vi.waitFor(() => expect(dave.received).toContainEqual({ type: "report_sent" }));
    expect(refused).toBe(true);
    expect(dave.received).toContainEqual(expect.objectContaining({ type: "question", retry: true }));
    const { report } = saved.at(-1) as (typeof saved)[number];
    expect(report.responses).not.toContainEqual(expect.objectContaining({ index: 99 }));
    const replayed = await replay(JSON.parse(JSON.stringify(report)));
    const seen = replayed.filter((msg) => !ANSWERS.has(msg.type)).flatMap((msg) => visibleTo(msg, 0) ?? []);
    const expected = dave.messages().filter((msg) => msg.type !== "stats");
    expect(wire(seen.slice(0, expected.length))).toEqual(expected);
  });

  it("refuse un texte de plus de 500 caractères et un signalement hors d'une salle", async () => {
    const before = saved.length;
    const bob = await player("bob", 0);
    bob.send({ type: "report" });
    await vi.waitFor(() => expect(bob.received).toContainEqual({ type: "error", error: "pas dans une salle" }));
    bob.send({ type: "bot" });
    await vi.waitFor(() => expect(bob.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    bob.send({ type: "report", message: "x".repeat(REPORT_MAX + 1) });
    await vi.waitFor(() => expect(bob.received).toContainEqual({ type: "error", error: "texte trop long : 500 caractères au maximum" }));
    bob.send({ type: "report", message: "x".repeat(REPORT_MAX) });
    await vi.waitFor(() => expect(bob.received).toContainEqual({ type: "report_sent" }));
    expect(saved).toHaveLength(before + 1);
    expect(saved.at(-1)?.message).toHaveLength(REPORT_MAX);
  });

  it("dit au joueur qu'il a trop signalé quand la limite est atteinte", { timeout: 30_000 }, async () => {
    const carol = await player("carol", 0);
    carol.send({ type: "bot" });
    await vi.waitFor(() => expect(carol.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    allowed = false;
    carol.send({ type: "report" });
    await vi.waitFor(() => expect(carol.received).toContainEqual({ type: "error", error: "trop de signalements, réessayez dans une heure" }));
    allowed = true;
  });
});
