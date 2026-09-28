import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgProcessResult, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { advance, startServer, type Room } from "../src/server.ts";

type Received = Wire<ServerMessage>;
type Answer = (question: OcgMessage, retry: boolean) => OcgResponse | undefined;

const wss = startServer(0, () => [1n, 2n, 3n, 4n]);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A client that records everything and answers its questions with `answer` (undefined keeps the question pending).
async function connect(answer: Answer = respond) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  socket.on("message", (data) => {
    const msg: Received = JSON.parse(String(data));
    received.push(msg);
    // respond() reads no bigint field, so the wire form of a question works as is.
    const response = msg.type === "question" ? answer(msg.question as unknown as OcgMessage, msg.retry) : undefined;
    if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
  });
  await once(socket, "open");
  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
  return { socket, received, send, messages };
}

const joined = (received: Received[]) => received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");

describe("serveur de partie", () => {
  it("joue un duel à deux sans fuite d'information cachée, avec reconnexion", { timeout: 30_000 }, async () => {
    let setCode = 0;
    let retried = false;
    // A sends a wrong answer once, then sets a monster face down at the first chance.
    const a = await connect((question, retry) => {
      if (question.type !== OcgMessageType.SELECT_IDLECMD || setCode) return respond(question);
      if (!retried && !retry) {
        retried = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 99 };
      }
      if (question.monster_sets.length === 0) return respond(question);
      setCode = question.monster_sets[0].code;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
    });
    a.send({ type: "create", player: "alice" });
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    const room = joined(a.received)?.room ?? "";

    // B stops answering once A's monster is set, so the duel waits on B.
    let held: OcgMessage | undefined;
    const b = await connect((question) => {
      if (!b.messages().some((msg) => msg.type === OcgMessageType.SET && msg.controller === 0)) return respond(question);
      held = question;
      return undefined;
    });
    b.send({ type: "join", room, player: "bob" });
    await vi.waitFor(() => expect(held).toBeDefined(), { timeout: 20_000 });

    expect(a.received).toContainEqual(expect.objectContaining({ type: "question", retry: true }));
    expect(a.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.MOVE, card: setCode }));
    expect(b.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.SET, controller: 0, code: 0 }));
    for (const msg of b.messages()) if (msg.type === OcgMessageType.DRAW && msg.player === 0) expect(msg.drawn.every((card) => card.code === 0)).toBe(true);
    expect(JSON.stringify(b.received)).not.toContain(String(setCode));
    for (const msg of b.received) if (msg.type === "question") expect(msg.question).toMatchObject({ player: 1 });

    // B reconnects with the same identity: same visible history, same pending question.
    b.socket.close();
    const b2 = await connect();
    b2.send({ type: "join", room, player: "bob" });
    await vi.waitFor(() => expect(b2.messages().length).toBeGreaterThan(0));
    expect(joined(b2.received)).toEqual({ type: "joined", room, seat: 1, log: b.messages() });
    expect(b2.received).toContainEqual({ type: "question", question: held, retry: false });
  });

  it("une salle dont le moteur lève une erreur est fermée, une autre salle continue de jouer", () => {
    type Duel = NonNullable<Room["duel"]>;
    const fakeDuel = (lib: Partial<Duel["lib"]>): Duel => ({ lib, handle: 1 }) as unknown as Duel;
    const socket = () => {
      const send = vi.fn();
      return { send, socket: { send } as unknown as WebSocket };
    };

    const destroyDuel = vi.fn();
    const a = socket();
    const b = socket();
    const crashing: Room = {
      code: "CRASH",
      players: [
        { id: "a", socket: a.socket, log: [] },
        { id: "b", socket: b.socket, log: [] },
      ],
      duel: fakeDuel({
        duelProcess: () => {
          throw new Error("panique moteur");
        },
        duelGetMessage: vi.fn(),
        destroyDuel,
      }),
    };
    advance(crashing);
    expect(crashing.duel).toBeUndefined();
    expect(destroyDuel).toHaveBeenCalledWith(1);
    expect(a.send).toHaveBeenCalledWith(expect.stringContaining('"duel_error"'));
    expect(b.send).toHaveBeenCalledWith(expect.stringContaining('"duel_error"'));

    const question = { type: OcgMessageType.SELECT_YESNO, player: 0, description: 0n, code: 0, data: { location: 0, controller: 0, sequence: 0 } } as unknown as OcgMessage;
    const c = socket();
    const other: Room = {
      code: "OTHER",
      players: [{ id: "c", socket: c.socket, log: [] }, { id: "d", socket: socket().socket, log: [] }],
      duel: fakeDuel({ duelProcess: vi.fn(() => OcgProcessResult.WAITING), duelGetMessage: vi.fn(() => [question]), destroyDuel: vi.fn() }),
    };
    advance(other);
    expect(other.duel).toBeDefined();
    expect(other.question).toEqual(question);
    expect(c.send).toHaveBeenCalledWith(expect.stringContaining('"question"'));
  });

  it("refuse une salle inconnue et une salle complète", async () => {
    const [c, d, e] = await Promise.all([connect(), connect(), connect()]);
    c.send({ type: "join", room: "ZZZZZ", player: "carol" });
    await vi.waitFor(() => expect(c.received).toContainEqual({ type: "error", error: "salle introuvable" }));
    c.send({ type: "create", player: "carol" });
    await vi.waitFor(() => expect(joined(c.received)).toBeDefined());
    const room = joined(c.received)?.room ?? "";
    d.send({ type: "join", room, player: "dave" });
    await vi.waitFor(() => expect(joined(d.received)).toBeDefined());
    e.send({ type: "join", room, player: "eve" });
    await vi.waitFor(() => expect(e.received).toContainEqual({ type: "error", error: "salle complète" }));
  });
});
