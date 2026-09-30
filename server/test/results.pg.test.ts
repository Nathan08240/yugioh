import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { createProfile, type Db } from "../src/db.ts";
import type { ClientMessage, ServerMessage } from "../src/protocol.ts";
import { readResults, recordResult } from "../src/results.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { chooseStarter } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("résultats des duels sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;
  let wss: WebSocketServer;
  let url: string;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
    wss = startServer(0, { ...dbAccounts(server), verify: async (token) => token }, () => [1n, 2n, 3n, 4n], 0);
    await once(wss, "listening");
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    wss?.close();
    await pg?.stop();
  });

  async function newPlayer(pseudo: string): Promise<string> {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, pseudo);
    return id;
  }

  const newDeck = async (userId: string, name: string): Promise<number> => {
    const [{ id }] = await admin<{ id: string }[]>`insert into yugioh.decks (user_id, name) values (${userId}, ${name}) returning id`;
    return Number(id);
  };
  const result = { mode: "online", won: true, reason: 0, turns: 4 } as const;

  it("totalise victoires et défaites par deck et par mode, un deck supprimé devient nul", async () => {
    const id = await newPlayer("Yugi");
    const [dragons, magicians] = [await newDeck(id, "Dragons"), await newDeck(id, "Magiciens")];
    await recordResult(server, { userId: id, deckId: dragons, ...result });
    await recordResult(server, { userId: id, deckId: dragons, ...result, won: false, reason: 3 });
    await recordResult(server, { userId: id, deckId: dragons, mode: "bot", level: "expert", won: true, reason: 0, turns: 7 });
    await recordResult(server, { userId: id, deckId: magicians, mode: "story", level: "facile", won: false, reason: 1, turns: 0 });
    await recordResult(server, { userId: id, ...result });

    expect(await readResults(server, id)).toEqual([
      { deck: dragons, mode: "bot", wins: 1, losses: 0 },
      { deck: dragons, mode: "online", wins: 1, losses: 1 },
      { deck: magicians, mode: "story", wins: 0, losses: 1 },
      { deck: null, mode: "online", wins: 1, losses: 0 },
    ]);

    await admin`delete from yugioh.decks where id = ${magicians}`;
    const after = await readResults(server, id);
    expect(after).toContainEqual({ deck: null, mode: "story", wins: 0, losses: 1 });
    expect(after.filter((row) => row.deck === null)).toHaveLength(2);
  });

  it("enregistre un résultat sans deck quand le deck a été supprimé depuis le lancement, ou appartient à un autre joueur", async () => {
    const [a, b] = [await newPlayer("Joey"), await newPlayer("Tea")];
    const gone = await newDeck(a, "Éphémère");
    await admin`delete from yugioh.decks where id = ${gone}`;
    await recordResult(server, { userId: a, deckId: gone, ...result });
    await recordResult(server, { userId: b, deckId: await newDeck(a, "Autre"), ...result });

    expect(await readResults(server, a)).toEqual([{ deck: null, mode: "online", wins: 1, losses: 0 }]);
    expect(await readResults(server, b)).toEqual([{ deck: null, mode: "online", wins: 1, losses: 0 }]);
  });

  it("garde le journal en ajout seul et refuse un mode inconnu", async () => {
    const id = await newPlayer("Kaiba");
    await recordResult(server, { userId: id, ...result });

    await expect(server`update yugioh.duel_results set won = false`).rejects.toThrow("permission denied");
    await expect(server`delete from yugioh.duel_results`).rejects.toThrow("permission denied");
    await expect(recordResult(server, { userId: id, ...result, mode: "tournoi" as "online" })).rejects.toThrow("duel_results_mode_check");
  });

  it("un duel contre le bot abandonné est enregistré avec le deck actif, et duel_results le relit", { timeout: 30_000 }, async () => {
    const id = await newPlayer("Mai");
    await chooseStarter(server, id, "yugi");
    const socket = new WebSocket(url);
    const received: ServerMessage[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: id });
    send({ type: "bot" });
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    send({ type: "surrender" });
    await vi.waitFor(async () => expect(await readResults(server, id)).toHaveLength(1));
    send({ type: "duel_results" });
    await vi.waitFor(() => expect(received.at(-1)).toMatchObject({ type: "duel_results", results: [{ deck: expect.any(Number), mode: "bot", wins: 0, losses: 1 }] }));
    socket.close();

    const rows = await admin`select mode, level, won, reason from yugioh.duel_results where user_id = ${id}`;
    expect(rows).toEqual([{ mode: "bot", level: "normal", won: false, reason: 0 }]);
  });
});
