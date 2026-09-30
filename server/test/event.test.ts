import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { EVENTS, eventOf, eventRules } from "../src/event.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { startServer } from "../src/server.ts";
import { EXTRA_RULES, STORY_DUELS } from "../src/story.ts";
import { fakeAccounts, GOAT_YUGI } from "./fakes.ts";

const at = (iso: string) => eventOf(new Date(iso));
const WEEK = 7 * 86_400_000;

describe("événement de la semaine", () => {
  it("change le lundi à minuit, heure de Paris, et garde la même règle toute la semaine", () => {
    expect(at("2026-09-30T12:00:00+02:00").id).toBe("2026-W40");
    const monday = at("2026-09-28T00:00:00+02:00");
    expect(at("2026-09-27T23:59:59+02:00").id).toBe("2026-W39");
    expect(monday.id).toBe("2026-W40");
    expect(at("2026-10-04T23:59:59+02:00")).toEqual(monday);
    // 22:30 UTC on Sunday is already Monday in Paris.
    expect(at("2026-10-04T22:30:00Z").id).toBe("2026-W41");
    expect(at("2026-10-05T00:00:00+02:00").rule).not.toBe(monday.rule);
  });

  it("numérote les semaines ISO à la fin de l'année et alterne les règles sans à-coup", () => {
    expect(at("2026-12-31T12:00:00+01:00").id).toBe("2026-W53");
    expect(at("2027-01-03T23:00:00+01:00").id).toBe("2026-W53");
    expect(at("2027-01-04T00:00:00+01:00").id).toBe("2027-W01");
    const start = Date.parse("2026-01-05T12:00:00+01:00");
    const rules = Array.from({ length: 120 }, (_, week) => eventOf(new Date(start + week * WEEK)).rule);
    for (let week = 1; week < rules.length; week++) expect(rules[week]).not.toBe(rules[week - 1]);
    expect(new Set(rules)).toEqual(new Set(EVENTS.map((event) => event.rule)));
  });

  it("joue chaque règle avec les LP et la main de son arc, et ajoute sa carte de règle au duel", () => {
    for (const event of EVENTS) {
      const duel = [...STORY_DUELS.values()].find((candidate) => candidate.rules.special?.includes(event.rule));
      expect(duel?.rules).toMatchObject({ lp: event.lp, hand: event.hand });
      expect(eventRules({ ...event, id: "x" })).toEqual({ lp: event.lp, hand: event.hand, cards: [EXTRA_RULES.get(event.rule)] });
    }
  });

  it("chaque règle de l'événement va au bout bot contre bot", { timeout: 120_000 }, async () => {
    for (const event of EVENTS) {
      const rules = eventRules({ ...event, id: "x" });
      for (let seed = 1n; seed <= 3n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + 1, KAIBA.length], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, KAIBA], rules);
        expect(state.winner, `${event.rule} seed ${seed}`).not.toBeNull();
        expect(state.errors).toEqual([]);
        expect(state.scripts).toContain(`c${EXTRA_RULES.get(event.rule)}.lua`);
      }
    }
  });
});

describe("salles d'événement sur le serveur", () => {
  type Received = Wire<ServerMessage>;
  const event = eventOf();
  const taken = new Set<string>();
  const claims: string[] = [];
  // Yugi's deck as it comes, outside the Goat list, for the users named "hors-liste-...".
  const accounts = fakeAccounts({
    activeDeck: async (userId) => ({ main: userId.startsWith("hors-liste") ? YUGI : GOAT_YUGI, extra: [] }),
    eventWon: async (userId, eventId) => taken.has(`${userId}:${eventId}`),
    claimEvent: async (userId, eventId) => {
      const key = `${userId}:${eventId}`;
      claims.push(key);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    },
  });

  // Nobody answers: a duel waits on its first question, where a player can give up.
  async function client(url: string, user: string) {
    const socket = new WebSocket(url);
    const received: Received[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    const joined = () => received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");
    return { send, received, joined };
  }

  async function server() {
    const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    return `ws://localhost:${(wss.address() as AddressInfo).port}`;
  }

  const won = (received: Received[]) => received.some((msg) => msg.type === "messages" && msg.messages.some((m) => m.type === OcgMessageType.WIN));

  // An online event room where `loser` gives up once the first question is asked: `winner` wins.
  async function onlineWin(url: string, winner: string, loser: string) {
    const a = await client(url, winner);
    a.send({ type: "create", event: true });
    await vi.waitFor(() => expect(a.joined()).toBeDefined());
    const b = await client(url, loser);
    b.send({ type: "join", room: a.joined()?.room ?? "" });
    await vi.waitFor(() => expect([...a.received, ...b.received].some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    b.send({ type: "surrender" });
    await vi.waitFor(() => expect(won(a.received)).toBe(true));
    return a;
  }

  it("annonce la règle de la semaine et si son booster est déjà pris", async () => {
    const url = await server();
    const a = await client(url, "annonce");
    a.send({ type: "event" });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "event", rule: event.rule, lp: event.lp, hand: event.hand, won: false }));
    taken.add(`annonce:${event.id}`);
    a.send({ type: "event" });
    await vi.waitFor(() => expect(a.received.at(-1)).toEqual({ type: "event", rule: event.rule, lp: event.lp, hand: event.hand, won: true }));
  });

  it("une salle en ligne d'événement applique la règle aux deux joueurs, un duel normal n'en a pas", async () => {
    const url = await server();
    const host = await client(url, "hote-evenement");
    host.send({ type: "create", event: true });
    await vi.waitFor(() => expect(host.joined()).toMatchObject({ lp: event.lp, special: [event.rule], decks: [YUGI.length + 1, 0] }));
    const guest = await client(url, "invite-evenement");
    guest.send({ type: "join", room: host.joined()?.room ?? "" });
    await vi.waitFor(() => expect(guest.joined()).toMatchObject({ seat: 1, lp: event.lp, special: [event.rule], decks: [YUGI.length + 1, YUGI.length] }));

    const normal = await client(url, "hote-normal");
    normal.send({ type: "create" });
    await vi.waitFor(() => expect(normal.joined()).toMatchObject({ lp: 4000, decks: [YUGI.length, 0] }));
    expect(normal.joined()?.special).toBeUndefined();
  });

  it("un duel contre le bot peut se jouer sous la règle de la semaine", async () => {
    const url = await server();
    const a = await client(url, "bot-evenement");
    a.send({ type: "bot", level: "expert", event: true });
    await vi.waitFor(() => expect(a.joined()).toMatchObject({ lp: event.lp, special: [event.rule] }));
    const normal = await client(url, "bot-normal");
    normal.send({ type: "bot" });
    await vi.waitFor(() => expect(normal.joined()).toMatchObject({ lp: 4000 }));
    expect(normal.joined()?.special).toBeUndefined();
  });

  it("refuse en événement un deck hors de la liste Goat, en création, en jonction et contre le bot, mais pas hors événement", async () => {
    const url = await server();
    const host = await client(url, "hote-liste");
    host.send({ type: "create", event: true });
    await vi.waitFor(() => expect(host.joined()).toBeDefined());
    const error = (received: Received[]) => received.find((msg) => msg.type === "error");
    for (const [name, message] of [["hors-liste-create", { type: "create", event: true }], ["hors-liste-bot", { type: "bot", event: true }], ["hors-liste-join", { type: "join", room: host.joined()?.room ?? "" }]] as const) {
      const outside = await client(url, name);
      outside.send(message);
      await vi.waitFor(() => expect(error(outside.received)).toMatchObject({ error: expect.stringContaining(" : interdite en événement") }));
      expect(outside.joined()).toBeUndefined();
    }
    const outside = await client(url, "hors-liste-normal");
    outside.send({ type: "bot" });
    await vi.waitFor(() => expect(outside.joined()).toBeDefined());
  });

  it("refuse un champ event qui n'est pas un booléen", async () => {
    const url = await server();
    const a = await client(url, "champ-invalide");
    a.send({ type: "create", event: "oui" as unknown as boolean });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "error", error: "message invalide" }));
  });

  it("la première victoire de la semaine donne un booster, pas la suivante", { timeout: 60_000 }, async () => {
    claims.length = 0;
    const url = await server();
    const first = await onlineWin(url, "gagnant", "perdant-1");
    await vi.waitFor(() => expect(first.received).toContainEqual({ type: "event_won" }));
    const second = await onlineWin(url, "gagnant", "perdant-2");
    await vi.waitFor(() => expect(claims).toEqual([`gagnant:${event.id}`, `gagnant:${event.id}`]));
    expect(second.received.filter((msg) => msg.type === "event_won")).toEqual([]);
    expect(taken.has(`perdant-1:${event.id}`)).toBe(false);
  });

  it("un duel normal, contre le bot ou en ligne, ne réclame aucun booster d'événement", { timeout: 60_000 }, async () => {
    claims.length = 0;
    const url = await server();
    const a = await client(url, "normal-a");
    a.send({ type: "create" });
    await vi.waitFor(() => expect(a.joined()).toBeDefined());
    const b = await client(url, "normal-b");
    b.send({ type: "join", room: a.joined()?.room ?? "" });
    await vi.waitFor(() => expect([...a.received, ...b.received].some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    b.send({ type: "surrender" });
    await vi.waitFor(() => expect(won(a.received)).toBe(true));
    expect(claims).toEqual([]);
  });
});
