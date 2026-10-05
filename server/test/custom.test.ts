import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { ROOM_LIMITS, roomRules, validRoomOptions } from "../src/custom.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { lpLeft, openDuel } from "../src/duel.ts";
import type { ClientMessage, RoomOptions, ServerMessage, Wire } from "../src/protocol.ts";
import { startServer } from "../src/server.ts";
import { EXTRA_RULES } from "../src/story.ts";
import { fakeAccounts, GOAT_YUGI } from "./fakes.ts";

type Received = Wire<ServerMessage>;

const BASE: RoomOptions = { lp: 4000, hand: 5, goat: false };
const SEED: [bigint, bigint, bigint, bigint] = [1n, 2n, 3n, 4n];

describe("options d'une salle personnalisée", () => {
  it("n'accepte que des valeurs de la liste fermée, sans champ en trop", () => {
    for (const options of [BASE, { lp: 8000, hand: 4, goat: true }, { lp: 8000, hand: 6, goat: false, rule: "battle-city" }, { ...BASE, rule: "duelist-kingdom" }]) {
      expect(validRoomOptions(options), JSON.stringify(options)).toBe(true);
    }
    const refused: unknown[] = [
      undefined,
      null,
      "8000",
      [],
      {},
      { ...BASE, lp: 5000 },
      { ...BASE, lp: "8000" },
      { ...BASE, hand: 3 },
      { ...BASE, hand: 7 },
      { ...BASE, hand: 5.5 },
      { ...BASE, goat: 1 },
      { lp: 4000, hand: 5 },
      { ...BASE, rule: "virtual-world" },
      { ...BASE, rule: "inconnue" },
      { ...BASE, rule: null },
      { ...BASE, extra: true },
    ];
    for (const options of refused) expect(validRoomOptions(options), JSON.stringify(options)).toBe(false);
  });

  it("traduit les options en règles du moteur (LP, main, carte de règle), et le moteur part des LP choisis", async () => {
    expect(roomRules(BASE)).toEqual({ lp: 4000, hand: 5, cards: [] });
    const rule = EXTRA_RULES.get("battle-city") as number;
    expect(roomRules({ lp: 8000, hand: 4, goat: true, rule: "battle-city" })).toEqual({ lp: 8000, hand: 4, cards: [rule] });

    for (const [lp, hand] of [[8000, 4], [4000, 6]] as const) {
      const duel = await openDuel(SEED, [YUGI, KAIBA], () => {}, undefined, roomRules({ ...BASE, lp, hand }));
      expect([lpLeft(duel, 0), lpLeft(duel, 1)]).toEqual([lp, lp]);
      duel.lib.destroyDuel(duel.handle);
    }
  });
});

describe("salles personnalisées sur le serveur", () => {
  const friendRow = (pseudo: string) => ({ id: pseudo, pseudo, avatar: null, status: "accepted" as const });
  // Yugi's deck as it comes, outside the Goat list, for the users named "hors-liste-...".
  const accounts = fakeAccounts({
    activeDeck: async (userId) => ({ main: userId.startsWith("hors-liste") ? YUGI : GOAT_YUGI, extra: [] }),
    friendList: async (id) => [friendRow(id === "defi-hote" ? "defi-invite" : "defi-hote")],
  });

  async function client(url: string, user: string) {
    const socket = new WebSocket(url);
    const received: Received[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    onTestFinished(() => socket.close());
    const send = (msg: ClientMessage | object) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "profile")).toBe(true));
    const joined = () => received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");
    const errors = () => received.flatMap((msg) => (msg.type === "error" ? [msg.error] : []));
    // Cards each player drew at the start, from the first two DRAW messages seen (a third is the draw of turn 1).
    const draws = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages.filter((m) => m.type === OcgMessageType.DRAW) : [])).slice(0, 2).map((msg) => (msg as { drawn: unknown[] }).drawn.length);
    return { send, received, joined, errors, draws };
  }

  async function server() {
    const wss = startServer(0, accounts, () => SEED, 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    return `ws://localhost:${(wss.address() as AddressInfo).port}`;
  }

  it("applique LP, main de départ et règle spéciale aux deux joueurs, et montre les règles à l'invité avant qu'il rejoigne", { timeout: 30_000 }, async () => {
    const url = await server();
    const options: RoomOptions = { lp: 8000, hand: 6, goat: false, rule: "battle-city" };
    const host = await client(url, "hote-perso");
    host.send({ type: "create", options });
    await vi.waitFor(() => expect(host.joined()).toMatchObject({ seat: 0, lp: 8000, special: ["battle-city"], options, decks: [YUGI.length + 1, 0] }));

    const guest = await client(url, "invite-perso");
    guest.send({ type: "room_rules", room: host.joined()?.room ?? "" });
    await vi.waitFor(() => expect(guest.received).toContainEqual({ type: "room_rules", room: host.joined()?.room, options }));
    expect(guest.joined()).toBeUndefined();
    guest.send({ type: "join", room: host.joined()?.room ?? "" });
    await vi.waitFor(() => expect(guest.joined()).toMatchObject({ seat: 1, lp: 8000, special: ["battle-city"], options, decks: [YUGI.length + 1, YUGI.length] }));

    // The opening hands: 6 cards each, the rule card having left seat 0's deck.
    await vi.waitFor(() => expect(host.draws().length).toBeGreaterThanOrEqual(2), { timeout: 20_000 });
    expect(host.draws()).toEqual([6, 6]);
  });

  it("une main de 4 cartes et 4000 LP, sans règle spéciale", { timeout: 30_000 }, async () => {
    const url = await server();
    const host = await client(url, "hote-main");
    host.send({ type: "create", options: { lp: 4000, hand: 4, goat: false } });
    await vi.waitFor(() => expect(host.joined()).toMatchObject({ lp: 4000, options: { lp: 4000, hand: 4, goat: false }, decks: [YUGI.length, 0] }));
    expect(host.joined()?.special).toBeUndefined();
    const guest = await client(url, "invite-main");
    guest.send({ type: "join", room: host.joined()?.room ?? "" });
    await vi.waitFor(() => expect(host.draws().length).toBeGreaterThanOrEqual(2), { timeout: 20_000 });
    expect(host.draws()).toEqual([4, 4]);
  });

  it("refuse les options hors liste, ou données avec l'événement, et laisse une salle standard sans règles", async () => {
    const url = await server();
    const host = await client(url, "hote-invalide");
    const bad: unknown[] = [{ lp: 5000, hand: 5, goat: false }, { lp: 4000, hand: 5, goat: false, rule: "virtual-world" }, { lp: 4000, hand: 5 }, "8000"];
    for (const options of bad) host.send({ type: "create", options });
    host.send({ type: "create", event: true, options: BASE });
    host.send({ type: "challenge", pseudo: "defi-invite", options: { lp: 1, hand: 5, goat: false } });
    await vi.waitFor(() => expect(host.errors()).toHaveLength(bad.length + 2));
    expect(new Set(host.errors())).toEqual(new Set(["message invalide"]));
    expect(host.joined()).toBeUndefined();

    host.send({ type: "create" });
    await vi.waitFor(() => expect(host.joined()).toMatchObject({ lp: 4000, decks: [YUGI.length, 0] }));
    expect(host.joined()?.options).toBeUndefined();
    const guest = await client(url, "invite-invalide");
    guest.send({ type: "room_rules", room: host.joined()?.room ?? "" });
    await vi.waitFor(() => expect(guest.received).toContainEqual({ type: "room_rules", room: host.joined()?.room }));
    guest.send({ type: "room_rules", room: "ZZZZZ" });
    await vi.waitFor(() => expect(guest.errors()).toContain("salle introuvable"));
  });

  it("la liste Goat s'applique aux deux decks de la salle, à l'hôte comme à l'invité", { timeout: 30_000 }, async () => {
    const url = await server();
    const goat: RoomOptions = { ...BASE, goat: true };
    const offList = await client(url, "hors-liste-hote");
    offList.send({ type: "create", options: goat });
    await vi.waitFor(() => expect(offList.errors().at(-1)).toContain(ROOM_LIMITS));
    expect(offList.joined()).toBeUndefined();
    offList.send({ type: "challenge", pseudo: "defi-invite", options: goat });
    await vi.waitFor(() => expect(offList.errors()).toHaveLength(2));
    expect(offList.errors()[1]).toContain(ROOM_LIMITS);

    const host = await client(url, "hote-goat");
    host.send({ type: "create", options: goat });
    await vi.waitFor(() => expect(host.joined()).toMatchObject({ options: goat }));
    const room = host.joined()?.room ?? "";
    offList.send({ type: "join", room });
    await vi.waitFor(() => expect(offList.errors()).toHaveLength(3));
    expect(offList.errors()[2]).toContain(ROOM_LIMITS);
    // The same deck goes into a room that does not apply the list.
    const open = await client(url, "hors-liste-libre");
    open.send({ type: "create", options: { ...BASE, hand: 6 } });
    await vi.waitFor(() => expect(open.joined()).toMatchObject({ decks: [YUGI.length, 0] }));
  });

  it("un défi porte les règles de l'hôte jusqu'à l'ami, qui les voit avant d'accepter, puis dans son duel", { timeout: 30_000 }, async () => {
    const url = await server();
    const options: RoomOptions = { lp: 8000, hand: 4, goat: true, rule: "duelist-kingdom" };
    const host = await client(url, "defi-hote");
    const guest = await client(url, "defi-invite");
    host.send({ type: "challenge", pseudo: "defi-invite", options });
    await vi.waitFor(() => expect(guest.received).toContainEqual({ type: "challenged", from: "defi-hote", ms: 60_000, options }));
    guest.send({ type: "challenge_reply", pseudo: "defi-hote", accept: true });
    for (const player of [host, guest]) {
      await vi.waitFor(() => expect(player.joined()).toMatchObject({ lp: 8000, special: ["duelist-kingdom"], options }));
    }
    await vi.waitFor(() => expect(host.draws().length).toBeGreaterThanOrEqual(2), { timeout: 20_000 });
    expect(host.draws()).toEqual([4, 4]);
  });
});
