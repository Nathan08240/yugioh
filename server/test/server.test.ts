import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgProcessResult, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { advance, startServer, type Accounts, type Room } from "../src/server.ts";

type Received = Wire<ServerMessage>;
type Answer = (question: OcgMessage, retry: boolean) => OcgResponse | undefined;

// Token "jeton-<id>" identifies user <id>; "nouveau" has no profile yet and "pris" is a taken pseudo.
const accounts: Accounts = {
  verify: async (token) => (token.startsWith("jeton-") ? token.slice(6) : null),
  findProfile: async (userId) => (userId === "nouveau" ? undefined : { userId, pseudo: userId }),
  createProfile: async (userId, pseudo) => (pseudo === "pris" ? undefined : { userId, pseudo }),
};
const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n]);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A client logged in as `user` (if any) that records everything and answers its questions with `answer`
// (undefined keeps the question pending).
async function connect(user?: string, answer: Answer = respond) {
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
  if (user) send({ type: "auth", token: `jeton-${user}` });
  const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
  return { socket, received, send, messages };
}

const joined = (received: Received[]) => received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");

describe("serveur de partie", () => {
  it("joue un duel à deux sans fuite d'information cachée, avec reconnexion", { timeout: 30_000 }, async () => {
    let setCode = 0;
    let retried = false;
    // A sends a wrong answer once, then sets a monster face down at the first chance.
    const a = await connect("alice", (question, retry) => {
      if (question.type !== OcgMessageType.SELECT_IDLECMD || setCode) return respond(question);
      if (!retried && !retry) {
        retried = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 99 };
      }
      if (question.monster_sets.length === 0) return respond(question);
      setCode = question.monster_sets[0].code;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
    });
    a.send({ type: "create" });
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    const room = joined(a.received)?.room ?? "";

    // B stops answering once A's monster is set, so the duel waits on B.
    let held: OcgMessage | undefined;
    const b = await connect("bob", (question) => {
      if (!b.messages().some((msg) => msg.type === OcgMessageType.SET && msg.controller === 0)) return respond(question);
      held = question;
      return undefined;
    });
    b.send({ type: "join", room });
    await vi.waitFor(() => expect(held).toBeDefined(), { timeout: 20_000 });

    expect(a.received).toContainEqual(expect.objectContaining({ type: "question", retry: true }));
    expect(a.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.MOVE, card: setCode }));
    expect(b.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.SET, controller: 0, code: 0 }));
    for (const msg of b.messages()) if (msg.type === OcgMessageType.DRAW && msg.player === 0) expect(msg.drawn.every((card) => card.code === 0)).toBe(true);
    expect(JSON.stringify(b.received)).not.toContain(String(setCode));
    for (const msg of b.received) if (msg.type === "question") expect(msg.question).toMatchObject({ player: 1 });

    // B reconnects with the same identity: same visible history, same pending question.
    b.socket.close();
    const b2 = await connect("bob");
    b2.send({ type: "join", room });
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
    const [c, d, e] = await Promise.all([connect("carol"), connect("dave"), connect("eve")]);
    c.send({ type: "join", room: "ZZZZZ" });
    await vi.waitFor(() => expect(c.received).toContainEqual({ type: "error", error: "salle introuvable" }));
    c.send({ type: "create" });
    await vi.waitFor(() => expect(joined(c.received)).toBeDefined());
    const room = joined(c.received)?.room ?? "";
    d.send({ type: "join", room });
    await vi.waitFor(() => expect(joined(d.received)).toBeDefined());
    e.send({ type: "join", room });
    await vi.waitFor(() => expect(e.received).toContainEqual({ type: "error", error: "salle complète" }));
  });

  it("refuse toute action avant authentification et un jeton invalide", async () => {
    const f = await connect();
    f.send({ type: "create" });
    f.send({ type: "respond", response: { type: OcgResponseType.SELECT_YESNO, yes: true } });
    f.send({ type: "auth", token: "faux" });
    f.send({ type: "join", room: "ZZZZZ" });
    await vi.waitFor(() => expect(f.received).toHaveLength(4));
    expect(f.received).toEqual([
      { type: "error", error: "non authentifié" },
      { type: "error", error: "non authentifié" },
      { type: "error", error: "jeton invalide" },
      { type: "error", error: "non authentifié" },
    ]);
  });

  it("authentifie par le jeton et fait choisir un pseudo au premier passage", async () => {
    const known = await connect("carol");
    await vi.waitFor(() => expect(known.received).toEqual([{ type: "profile", pseudo: "carol" }]));

    const g = await connect("nouveau");
    g.send({ type: "create" });
    g.send({ type: "pseudo", pseudo: "a b" });
    g.send({ type: "pseudo", pseudo: "pris" });
    g.send({ type: "pseudo", pseudo: "Nouveau_1" });
    g.send({ type: "auth", token: "jeton-autre" });
    g.send({ type: "create" });
    await vi.waitFor(() => expect(joined(g.received)).toBeDefined());
    expect(g.received.slice(0, 6)).toEqual([
      { type: "profile", pseudo: null },
      { type: "error", error: "pseudo à choisir d'abord" },
      { type: "error", error: expect.stringContaining("pseudo invalide") },
      { type: "error", error: "pseudo déjà pris" },
      { type: "profile", pseudo: "Nouveau_1" },
      { type: "error", error: "déjà authentifié" },
    ]);
  });
});
