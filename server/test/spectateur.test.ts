import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { KAIBA, YUGI } from "../src/decks.ts";
import { SPECTATORS_MAX, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import type { DuelResult } from "../src/results.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

const FLAME_SWORDSMAN = 45231177;

type Received = Wire<ServerMessage>;
type Client = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["connect"]>>;

// Token = user id; "bob" plays Kaiba's deck, the others Yugi's. `answer` (undefined keeps the question pending) defaults to the first option.
async function setup() {
  const recorded: DuelResult[] = [];
  const accounts = fakeAccounts({
    activeDeck: async (userId) => ({ main: userId === "bob" ? KAIBA : YUGI, extra: userId === "alice" ? [FLAME_SWORDSMAN] : [] }),
    recordResult: async (result) => void recorded.push(result),
  });
  const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
  onTestFinished(() => wss.close());
  await once(wss, "listening");
  const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;

  async function connect(user: string, answer: (question: OcgMessage) => OcgResponse | undefined = (question) => respond(question)) {
    const socket = new WebSocket(url);
    const received: Received[] = [];
    socket.on("message", (data) => {
      const msg: Received = JSON.parse(String(data));
      received.push(msg);
      const response = msg.type === "question" ? answer(msg.question as unknown as OcgMessage) : undefined;
      if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
    });
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
    return { socket, received, send, messages };
  }
  return { recorded, connect };
}

const joined = (client: Client) => client.received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");
const errors = (client: Client) => client.received.flatMap((msg) => (msg.type === "error" ? [msg.error] : []));
const counts = (client: Client) => client.received.flatMap((msg) => (msg.type === "spectators" ? [msg.count] : []));

// An online duel between two players who never answer, up to the first question.
async function duel(connect: Awaited<ReturnType<typeof setup>>["connect"], answers?: [Parameters<typeof connect>[1], Parameters<typeof connect>[1]]) {
  const a = await connect("alice", answers?.[0] ?? (() => undefined));
  a.send({ type: "create" });
  await vi.waitFor(() => expect(joined(a)).toBeDefined());
  const room = joined(a)?.room ?? "";
  const b = await connect("bob", answers?.[1] ?? (() => undefined));
  b.send({ type: "join", room });
  await vi.waitFor(() => expect([a, b].some((client) => client.received.some((msg) => msg.type === "question"))).toBe(true), { timeout: 20_000 });
  return { a, b, room };
}

describe("mode spectateur", () => {
  it("ne montre ni main ni carte face cachée d'aucun joueur, rejoue le journal à qui arrive en cours de duel", { timeout: 40_000 }, async () => {
    const { connect } = await setup();
    const set: number[] = [];
    // Each player sets a monster face down at the first chance; bob then stops answering.
    const setter = (seat: number) => (question: OcgMessage) => {
      if (question.type !== OcgMessageType.SELECT_IDLECMD) return respond(question);
      if (set[seat] !== undefined) return seat === 1 ? undefined : respond(question);
      if (question.monster_sets.length === 0) return respond(question);
      set[seat] = question.monster_sets[0].code;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 } satisfies OcgResponse;
    };
    const a = await connect("alice", setter(0));
    a.send({ type: "create" });
    await vi.waitFor(() => expect(joined(a)).toBeDefined());
    const room = joined(a)?.room ?? "";

    // A spectator comes before the first card is played, another one once both monsters are set.
    const early = await connect("dave");
    early.send({ type: "spectate", room });
    await vi.waitFor(() => expect(errors(early)).toEqual(["aucun duel en ligne à regarder dans cette salle"]));
    const b = await connect("bob", setter(1));
    b.send({ type: "join", room });
    await vi.waitFor(() => expect(joined(b)).toBeDefined());
    early.send({ type: "spectate", room });
    await vi.waitFor(() => expect(joined(early)).toBeDefined());
    await vi.waitFor(() => expect(set[0] !== undefined && set[1] !== undefined).toBe(true), { timeout: 30_000 });
    await vi.waitFor(() => expect(b.received.filter((msg) => msg.type === "question").length).toBeGreaterThan(0));
    const late = await connect("eve");
    late.send({ type: "spectate", room });
    await vi.waitFor(() => expect(joined(late)?.log.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Seen from seat 0, with the names of both seats and no question.
    expect(joined(late)).toMatchObject({ type: "joined", room, seat: 0, opponent: "bob", spectating: { name: "alice" } });
    expect(late.received.some((msg) => msg.type === "question")).toBe(false);
    // Same history for both, whenever they arrived.
    expect(joined(late)?.log).toEqual([...(joined(early)?.log ?? []), ...early.messages()]);
    // Neither hand nor face-down monster of either player: not a code, not a stat.
    const seen = JSON.stringify([late.received, early.received]);
    for (const code of set) expect(seen).not.toMatch(new RegExp(String.raw`"(code|card)":${code}\b`));
    // Nor the Extra Deck of a player: only its owner gets it, from the `joined` message.
    expect(seen).not.toContain(String(FLAME_SWORDSMAN));
    expect(joined(a)?.extra).toEqual([FLAME_SWORDSMAN]);
    expect(joined(b)?.extra).toBeUndefined();
    const log = joined(late)?.log ?? [];
    for (const msg of log) if (msg.type === OcgMessageType.DRAW) expect(msg.drawn.every((card) => card.code === 0)).toBe(true);
    expect(log).toContainEqual(expect.objectContaining({ type: OcgMessageType.SET, controller: 0, code: 0 }));
    expect(log).toContainEqual(expect.objectContaining({ type: OcgMessageType.SET, controller: 1, code: 0 }));
    const lastStats = log.filter((msg) => msg.type === "stats").at(-1);
    expect(lastStats?.monsters.flat().every((monster) => monster === null)).toBe(true);
    // The players are told about their spectators.
    expect(counts(a).at(-1)).toBe(2);
    expect(counts(late)).toEqual([2]);
  });

  it("n'accepte rien du spectateur dans la salle, ni pour un autre duel que deux joueurs en ligne", { timeout: 40_000 }, async () => {
    const { connect, recorded } = await setup();
    const { a, b, room } = await duel(connect);
    const spectator = await connect("dave");
    spectator.send({ type: "spectate", room: room.toLowerCase() });
    await vi.waitFor(() => expect(counts(a)).toEqual([1]));
    spectator.send({ type: "respond", response: { type: OcgResponseType.SELECT_YESNO, yes: true } });
    spectator.send({ type: "surrender" });
    spectator.send({ type: "emote", id: "bonjour" });
    spectator.send({ type: "spectate", room });
    spectator.send({ type: "create" });
    await vi.waitFor(() => expect(errors(spectator)).toEqual(["pas dans une salle", "pas dans une salle", "pas dans une salle", "déjà dans une salle", "déjà dans une salle"]));
    // A player cannot watch, and nothing happened to the duel.
    a.send({ type: "spectate", room });
    await vi.waitFor(() => expect(errors(a)).toEqual(["déjà dans une salle"]));
    expect(a.received.some((msg) => msg.type === "emote")).toBe(false);

    const missing = await connect("eve");
    missing.send({ type: "spectate", room: "ZZZZZ" });
    const bot = await connect("carol");
    bot.send({ type: "bot" });
    await vi.waitFor(() => expect(joined(bot)).toBeDefined());
    missing.send({ type: "spectate", room: joined(bot)?.room ?? "" });
    await vi.waitFor(() => expect(errors(missing)).toEqual(["salle introuvable", "aucun duel en ligne à regarder dans cette salle"]));

    // The spectator sees the end of the duel, which is recorded for the two players only.
    b.send({ type: "surrender" });
    await vi.waitFor(() => expect(spectator.messages()).toContainEqual({ type: OcgMessageType.WIN, player: 0, reason: 0 }));
    await vi.waitFor(() => expect(recorded.map((result) => result.userId).sort()).toEqual(["alice", "bob"]));
  });

  it("limite la salle à 20 spectateurs, le départ d'un spectateur libère une place et met le compte à jour", { timeout: 40_000 }, async () => {
    const { connect } = await setup();
    const { a, room } = await duel(connect);
    const crowd: Client[] = [];
    for (let i = 0; i < SPECTATORS_MAX + 1; i++) {
      const spectator = await connect(`spec-${i}`);
      spectator.send({ type: "spectate", room });
      crowd.push(spectator);
    }
    await vi.waitFor(() => expect(counts(a).at(-1)).toBe(SPECTATORS_MAX));
    const last = crowd[SPECTATORS_MAX];
    await vi.waitFor(() => expect(errors(last)).toEqual(["trop de spectateurs dans cette salle"]));

    crowd[0].socket.close();
    await vi.waitFor(() => expect(counts(a).at(-1)).toBe(SPECTATORS_MAX - 1));
    last.send({ type: "spectate", room });
    await vi.waitFor(() => expect(joined(last)).toBeDefined());
    expect(counts(a).at(-1)).toBe(SPECTATORS_MAX);
  });
});
