import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { CHALLENGE_TIME, type FriendRow, type FriendStore } from "../src/friends.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

type Received = Wire<ServerMessage>;

// Relations in memory, pseudo = user id; a pseudo starting with "inconnu" does not exist.
function memoryFriends(rows: { from: string; to: string; accepted: boolean }[] = []): FriendStore {
  const between = (a: string, b: string) => rows.findIndex((row) => (row.from === a && row.to === b) || (row.from === b && row.to === a));
  const status = (row: (typeof rows)[number], id: string): FriendRow["status"] => {
    if (row.accepted) return "accepted";
    return row.from === id ? "sent" : "received";
  };
  return {
    friendList: async (id) =>
      rows.filter((row) => row.from === id || row.to === id).map((row) => ({ id: row.from === id ? row.to : row.from, pseudo: row.from === id ? row.to : row.from, avatar: null, status: status(row, id) })),
    requestFriend: async (id, pseudo) => {
      if (pseudo.startsWith("inconnu")) return "joueur introuvable";
      const row = rows[between(id, pseudo)];
      if (row && (row.accepted || row.from === id)) return "demande déjà envoyée";
      if (row) row.accepted = true;
      else rows.push({ from: id, to: pseudo, accepted: false });
      return { id: pseudo, accepted: row !== undefined };
    },
    acceptFriend: async (id, pseudo) => {
      const row = rows.find((candidate) => candidate.from === pseudo && candidate.to === id && !candidate.accepted);
      if (row) row.accepted = true;
      return row && pseudo;
    },
    removeFriend: async (id, pseudo) => {
      const index = between(id, pseudo);
      if (index === -1) return undefined;
      rows.splice(index, 1);
      return pseudo;
    },
  };
}

async function setup(store = memoryFriends()) {
  const wss = startServer(0, fakeAccounts(store), () => [1n, 2n, 3n, 4n], 0);
  onTestFinished(() => wss.close());
  await once(wss, "listening");
  const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
  const clients: WebSocket[] = [];
  onTestFinished(() => clients.forEach((socket) => socket.close()));

  // Logged in as `user`, once the profile arrived.
  async function connect(user: string) {
    const socket = new WebSocket(url);
    clients.push(socket);
    const received: Received[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "profile")).toBe(true));
    const lists = () => received.flatMap((msg) => (msg.type === "friends" ? [msg.friends] : []));
    const close = async () => {
      socket.close();
      await once(socket, "close");
    };
    return { received, send, lists, close };
  }
  return { connect };
}

const notice = (text: string) => ({ type: "friend_notice", text });
const friend = (pseudo: string, status: string) => ({ pseudo, avatar: null, status });

describe("amis", () => {
  afterEach(() => vi.useRealTimers());

  it("envoie une demande, la fait accepter et suit le statut en ligne, en duel et hors ligne", async () => {
    const { connect } = await setup();
    const alice = await connect("alice");
    const bob = await connect("bob");
    alice.send({ type: "friend_add", pseudo: "bob" });
    await vi.waitFor(() => expect(bob.received).toContainEqual(notice("alice vous a envoyé une demande d'ami.")));
    expect(bob.lists().at(-1)).toEqual([friend("alice", "received")]);
    await vi.waitFor(() => expect(alice.lists().at(-1)).toEqual([friend("bob", "sent")]));

    bob.send({ type: "friend_accept", pseudo: "alice" });
    await vi.waitFor(() => expect(alice.received).toContainEqual(notice("bob a accepté votre demande d'ami.")));
    expect(alice.lists().at(-1)).toEqual([friend("bob", "online")]);
    await vi.waitFor(() => expect(bob.lists().at(-1)).toEqual([friend("alice", "online")]));

    await bob.close();
    await vi.waitFor(() => expect(alice.received).toContainEqual({ type: "friend_status", pseudo: "bob", status: "offline" }));
    const again = await connect("bob");
    await vi.waitFor(() => expect(alice.received.at(-1)).toEqual({ type: "friend_status", pseudo: "bob", status: "online" }));
    again.send({ type: "create" });
    await vi.waitFor(() => expect(alice.received.at(-1)).toEqual({ type: "friend_status", pseudo: "bob", status: "duel" }));
    alice.send({ type: "friends" });
    await vi.waitFor(() => expect(alice.lists().at(-1)).toEqual([friend("bob", "duel")]));
  });

  it("refuse une demande, retire un ami, et répond « joueur introuvable » à un pseudo inconnu", async () => {
    const { connect } = await setup();
    const carol = await connect("carol");
    const dave = await connect("dave");
    carol.send({ type: "friend_add", pseudo: "dave" });
    await vi.waitFor(() => expect(dave.lists()).toHaveLength(1));
    dave.send({ type: "friend_remove", pseudo: "carol" });
    await vi.waitFor(() => expect(carol.lists().at(-1)).toEqual([]));
    expect(dave.lists().at(-1)).toEqual([]);

    carol.send({ type: "friend_add", pseudo: "dave" });
    dave.send({ type: "friend_add", pseudo: "carol" });
    await vi.waitFor(() => expect(carol.lists().at(-1)).toEqual([friend("dave", "online")]));
    carol.send({ type: "friend_remove", pseudo: "dave" });
    await vi.waitFor(() => expect(dave.lists().at(-1)).toEqual([]));

    carol.send({ type: "friend_add", pseudo: "inconnu-x" });
    await vi.waitFor(() => expect(carol.received).toContainEqual({ type: "error", error: "joueur introuvable" }));
    dave.send({ type: "friend_accept", pseudo: "carol" });
    await vi.waitFor(() => expect(dave.received).toContainEqual({ type: "error", error: "aucune demande de ce joueur" }));
    carol.send({ type: "friend_add", pseudo: 42 } as unknown as ClientMessage);
    await vi.waitFor(() => expect(carol.received).toContainEqual({ type: "error", error: "message invalide" }));
  });

  it("un défi accepté met les deux amis dans la même salle en ligne ; un défi refusé prévient celui qui l'a lancé", { timeout: 30_000 }, async () => {
    const { connect } = await setup(memoryFriends([{ from: "erin", to: "fred", accepted: true }, { from: "erin", to: "gina", accepted: true }]));
    const erin = await connect("erin");
    const fred = await connect("fred");
    erin.send({ type: "challenge", pseudo: "gina" });
    await vi.waitFor(() => expect(erin.received).toContainEqual({ type: "error", error: "gina n'est pas disponible" }));
    erin.send({ type: "challenge", pseudo: "inconnu" });
    await vi.waitFor(() => expect(erin.received).toContainEqual({ type: "error", error: "ami introuvable" }));

    erin.send({ type: "challenge", pseudo: "fred" });
    await vi.waitFor(() => expect(fred.received).toContainEqual({ type: "challenged", from: "erin", ms: CHALLENGE_TIME }));
    expect(erin.received).toContainEqual(notice("Défi envoyé à fred."));
    fred.send({ type: "challenge_reply", pseudo: "erin", accept: false });
    await vi.waitFor(() => expect(erin.received).toContainEqual(notice("fred a refusé le défi.")));
    expect(fred.received).toContainEqual({ type: "challenge_gone", from: "erin" });

    erin.send({ type: "challenge", pseudo: "fred" });
    await vi.waitFor(() => expect(fred.received.filter((msg) => msg.type === "challenged")).toHaveLength(2));
    fred.send({ type: "challenge_reply", pseudo: "erin", accept: true });
    const joined = (client: typeof erin) => client.received.find((msg) => msg.type === "joined");
    await vi.waitFor(() => expect(joined(fred)).toMatchObject({ seat: 1, opponent: "erin" }));
    expect(joined(erin)).toMatchObject({ seat: 0, room: (joined(fred) as { room: string }).room });
    // The duel starts: both players get their first engine messages.
    await vi.waitFor(() => expect(erin.received.some((msg) => msg.type === "messages")).toBe(true), { timeout: 20_000 });
    fred.send({ type: "challenge_reply", pseudo: "erin", accept: true });
    await vi.waitFor(() => expect(fred.received).toContainEqual({ type: "error", error: "défi expiré" }));
  });

  it("une invitation sans réponse expire au bout de 60 s, celle d'un joueur parti disparaît", async () => {
    const { connect } = await setup(memoryFriends([{ from: "hugo", to: "iris", accepted: true }]));
    const hugo = await connect("hugo");
    const iris = await connect("iris");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    hugo.send({ type: "challenge", pseudo: "iris" });
    await vi.waitFor(() => expect(iris.received.some((msg) => msg.type === "challenged")).toBe(true));
    vi.advanceTimersByTime(CHALLENGE_TIME - 1);
    expect(iris.received).not.toContainEqual({ type: "challenge_gone", from: "hugo" });
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(iris.received).toContainEqual({ type: "challenge_gone", from: "hugo" }));
    await vi.waitFor(() => expect(hugo.received).toContainEqual(notice("iris n'a pas répondu au défi.")));
    iris.send({ type: "challenge_reply", pseudo: "hugo", accept: true });
    await vi.waitFor(() => expect(iris.received).toContainEqual({ type: "error", error: "défi expiré" }));

    hugo.send({ type: "challenge", pseudo: "iris" });
    await vi.waitFor(() => expect(iris.received.filter((msg) => msg.type === "challenged")).toHaveLength(2));
    await hugo.close();
    await vi.waitFor(() => expect(iris.received.filter((msg) => msg.type === "challenge_gone")).toHaveLength(2));
  });
});
