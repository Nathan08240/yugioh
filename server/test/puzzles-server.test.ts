import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Player } from "../src/duel.ts";
import { PUZZLE_FAILED, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import { PUZZLE_IDS, PUZZLES, type Puzzle } from "../src/puzzles.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";
import { pass, pupil, solver } from "./solver.ts";

type Received = Wire<ServerMessage>;

// Solved puzzles and boosters earned, per player.
const solved = new Map<string, Set<string>>();
const boosters = new Map<string, number>();
// Players who won the tutorial.
const tutorials = new Set<string>();
const accounts = fakeAccounts({
  solvedPuzzles: async (userId) => solved.get(userId) ?? new Set(),
  solvePuzzle: async (userId, id) => {
    const done = solved.get(userId) ?? new Set();
    solved.set(userId, done);
    const first = !done.has(id);
    done.add(id);
    if (first) boosters.set(userId, (boosters.get(userId) ?? 0) + 1);
    return first;
  },
  finishTutorial: async (userId) => {
    const first = !tutorials.has(userId);
    tutorials.add(userId);
    if (first) boosters.set(userId, (boosters.get(userId) ?? 0) + 1);
    return first;
  },
  // No active deck: a puzzle does not need one.
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
    // The wire form of a question and of the messages of this duel works as is: the solver reads no bigint field.
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

const puzzle = (id: string) => PUZZLE_IDS.get(id) as Puzzle;
// The tutorial lasts three turns: longer than the default second of waitFor on a busy machine.
const DUEL_WAIT = { timeout: 10_000 };
const won = (received: Received[]) => received.filter((msg) => msg.type === "puzzle_won");

describe("puzzles sur le serveur", () => {
  it("place l'état du puzzle sous les yeux du joueur, sans montrer la carte posée adverse", async () => {
    const client = await connect("tea", pass);
    client.send({ type: "puzzle", id: "miroir" });
    await vi.waitFor(() => expect(client.wins()).toHaveLength(1));
    const moves = client.received.flatMap((msg) => (msg.type === "messages" ? msg.messages : [])).filter((msg) => msg.type === OcgMessageType.MOVE && !msg.from.location);
    expect(moves.map((msg) => msg.type === OcgMessageType.MOVE && msg.card)).toEqual([...puzzle("miroir").player.hand ?? [], 11091375, 69140098, 0]);
    expect(client.received).toContainEqual(expect.objectContaining({ type: "joined", lp: 4000, opponentLp: 3800, decks: [0, 0] }));
    client.socket.close();
  });

  it("une réussite rapporte un booster la première fois seulement, « Réessayer » rejoue le même puzzle", { timeout: 30_000 }, async () => {
    const { solution } = puzzle("grand-final");
    const client = await connect("yugi", solver(solution));
    client.send({ type: "puzzle", id: "grand-final" });
    await vi.waitFor(() => expect(won(client.received)).toEqual([{ type: "puzzle_won", id: "grand-final", booster: true }]));
    expect(client.wins()).toEqual([expect.objectContaining({ player: 0, reason: 1 })]);

    client.retry(solver(solution));
    await vi.waitFor(() => expect(won(client.received)).toHaveLength(2));
    expect(won(client.received)[1]).toEqual({ type: "puzzle_won", id: "grand-final", booster: false });
    expect(boosters.get("yugi")).toBe(1);

    client.send({ type: "puzzles" });
    await vi.waitFor(() => expect(client.received.at(-1)).toMatchObject({ type: "puzzles" }));
    const list = client.received.at(-1) as Extract<Received, { type: "puzzles" }>;
    expect(list.puzzles).toHaveLength(PUZZLES.length);
    expect(list.puzzles.filter((view) => view.done).map((view) => view.id)).toEqual(["grand-final"]);
    expect(list.puzzles[0]).toEqual({ id: PUZZLES[0].id, title: PUZZLES[0].title, goal: PUZZLES[0].goal, done: false });
    client.socket.close();
  });

  it("finir son tour sans faire tomber les LP adverses échoue le puzzle, sans booster ni tour du bot", { timeout: 30_000 }, async () => {
    const client = await connect("joey", pass);
    client.send({ type: "puzzle", id: "coup-de-grace" });
    await vi.waitFor(() => expect(client.wins()).toEqual([{ type: OcgMessageType.WIN, player: 1, reason: PUZZLE_FAILED }]));
    const turns = client.received.flatMap((msg) => (msg.type === "messages" ? msg.messages : [])).filter((msg) => msg.type === OcgMessageType.NEW_TURN);
    expect(turns).toHaveLength(1);
    expect(won(client.received)).toEqual([]);
    expect(boosters.get("joey")).toBeUndefined();

    // Retrying after a failure plays the puzzle again, from the same state.
    client.retry(solver(puzzle("coup-de-grace").solution));
    await vi.waitFor(() => expect(won(client.received)).toEqual([{ type: "puzzle_won", id: "coup-de-grace", booster: true }]));
    client.socket.close();
  });

  it("le tutoriel suivi jusqu'au bout gagne un booster la première fois, « Réessayer » le rejoue", { timeout: 30_000 }, async () => {
    const client = await connect("bakura", pupil);
    client.send({ type: "tutorial" });
    await vi.waitFor(() => expect(won(client.received)).toEqual([{ type: "puzzle_won", id: "tutorial", booster: true }]), DUEL_WAIT);
    expect(client.wins()).toEqual([expect.objectContaining({ player: 0, reason: 1 })]);
    expect(client.received).toContainEqual(expect.objectContaining({ type: "joined", lp: 4000, opponentLp: 3000 }));

    client.retry(pupil);
    await vi.waitFor(() => expect(won(client.received)).toHaveLength(2), DUEL_WAIT);
    expect(won(client.received)[1]).toEqual({ type: "puzzle_won", id: "tutorial", booster: false });
    expect(boosters.get("bakura")).toBe(1);
    client.socket.close();
  });

  it("refuse un puzzle inconnu", async () => {
    const client = await connect("mai", pass);
    client.send({ type: "puzzle", id: "inconnu" });
    await vi.waitFor(() => expect(client.received).toContainEqual({ type: "error", error: "puzzle inconnu" }));
    client.socket.close();
  });
});
