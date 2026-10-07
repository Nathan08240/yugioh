import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Player } from "../src/duel.ts";
import { LESSON_IDS, LESSONS, type Lesson } from "../src/lessons.ts";
import { LESSON_POINTS, PUZZLE_FAILED, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";
import { lessonSolver } from "./lecons-solver.ts";
import { pass } from "./solver.ts";

type Received = Wire<ServerMessage>;

// Lessons won and collection points earned, per player.
const won = new Map<string, Set<string>>();
const points = new Map<string, number>();
const accounts = fakeAccounts({
  solvedLessons: async (userId) => won.get(userId) ?? new Set(),
  solveLesson: async (userId, id) => {
    const done = won.get(userId) ?? new Set();
    won.set(userId, done);
    const first = !done.has(id);
    done.add(id);
    if (first) points.set(userId, (points.get(userId) ?? 0) + LESSON_POINTS);
    return first;
  },
  // No active deck: a lesson does not need one.
  activeDeck: async () => undefined,
});
const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A client logged in as `user` that answers its questions with `player` (replaced for a new duel by `retry`).
async function connect(user: string, player: Player) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  let answer = player;
  socket.on("message", (data) => {
    const msg: Received = JSON.parse(String(data));
    received.push(msg);
    if (msg.type !== "question") return;
    const log = received.slice(received.findLastIndex((seen) => seen.type === "joined") + 1).flatMap((seen) => (seen.type === "messages" ? seen.messages : [])) as unknown as OcgMessage[];
    socket.send(JSON.stringify({ type: "respond", response: answer(msg.question as unknown as OcgMessage, log) } satisfies ClientMessage));
  });
  await once(socket, "open");
  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  send({ type: "auth", token: user });
  const wins = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : [])).filter((msg) => msg.type === OcgMessageType.WIN);
  const retry = (next: Player) => {
    answer = next;
    send({ type: "rematch" });
  };
  return { socket, received, send, wins, retry };
}

const lesson = (id: string) => LESSON_IDS.get(id) as Lesson;
const lessonsWon = (received: Received[]) => received.filter((msg) => msg.type === "lesson_won");

describe("leçons sur le serveur", () => {
  it("une victoire rapporte des points la première fois seulement, « Réessayer » rejoue la même leçon", { timeout: 30_000 }, async () => {
    const client = await connect("tea", lessonSolver(lesson("fusion").solution));
    client.send({ type: "lesson", id: "fusion" });
    await vi.waitFor(() => expect(lessonsWon(client.received)).toEqual([{ type: "lesson_won", id: "fusion", points: LESSON_POINTS }]));
    expect(client.wins()).toEqual([expect.objectContaining({ player: 0, reason: 1 })]);
    // The Extra Deck of the lesson is the player's: one card, none for the bot.
    expect(client.received).toContainEqual(expect.objectContaining({ type: "joined", lp: 4000, opponentLp: 2600, decks: [0, 0], extras: [1, 0] }));

    client.retry(lessonSolver(lesson("fusion").solution));
    await vi.waitFor(() => expect(lessonsWon(client.received)).toHaveLength(2));
    expect(lessonsWon(client.received)[1]).toEqual({ type: "lesson_won", id: "fusion", points: 0 });
    expect(points.get("tea")).toBe(LESSON_POINTS);

    client.send({ type: "lessons" });
    await vi.waitFor(() => expect(client.received.at(-1)).toMatchObject({ type: "lessons" }));
    const list = client.received.at(-1) as Extract<Received, { type: "lessons" }>;
    expect(list.lessons.map((view) => view.id)).toEqual(LESSONS.map((entry) => entry.id));
    expect(list.lessons.filter((view) => view.done).map((view) => view.id)).toEqual(["fusion"]);
    client.socket.close();
  });

  it("finir son tour sans gagner échoue la leçon, sans point", { timeout: 30_000 }, async () => {
    const client = await connect("joey", pass);
    client.send({ type: "lesson", id: "chaine" });
    await vi.waitFor(() => expect(client.wins()).toEqual([{ type: OcgMessageType.WIN, player: 1, reason: PUZZLE_FAILED }]));
    expect(lessonsWon(client.received)).toEqual([]);
    expect(points.get("joey")).toBeUndefined();
    client.socket.close();
  });

  it("refuse une leçon inconnue", async () => {
    const client = await connect("mai", pass);
    client.send({ type: "lesson", id: "inconnue" });
    await vi.waitFor(() => expect(client.received).toContainEqual({ type: "error", error: "leçon inconnue" }));
    client.socket.close();
  });
});
