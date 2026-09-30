import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { createProfile, type Db } from "../src/db.ts";
import type { ClientMessage, ServerMessage } from "../src/protocol.ts";
import { rateDuel, readLeaderboard, readRating } from "../src/ranked.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { chooseStarter } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("mode classé sur Postgres jetable", () => {
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

  const matches = (id: string) => admin`
    select winner, rating_a_before, rating_a_after, rating_b_before, rating_b_after, reason from yugioh.ranked_matches where player_a = ${id} or player_b = ${id}`;

  it("part de 1000, met à jour les deux joueurs et journalise le duel ; le classement liste les joueurs ayant joué", async () => {
    const [a, b, idle] = [await newPlayer("Yugi"), await newPlayer("Kaiba"), await newPlayer("Tea")];
    await admin`update yugioh.profiles set avatar_code = 46986414 where user_id = ${a}`;
    expect(await readRating(server, a)).toEqual({ rating: 1000, games: 0 });

    expect(await rateDuel(server, { players: [a, b], winner: 0, reason: 1 })).toEqual([
      { before: 1000, after: 1016 },
      { before: 1000, after: 984 },
    ]);
    expect(await readRating(server, a)).toEqual({ rating: 1016, games: 1 });
    expect(await readRating(server, b)).toEqual({ rating: 984, games: 1 });
    expect(await matches(a)).toEqual([{ winner: a, rating_a_before: 1000, rating_a_after: 1016, rating_b_before: 1000, rating_b_after: 984, reason: 1 }]);

    const board = await readLeaderboard(server);
    expect(board).toEqual([
      { pseudo: "Yugi", avatar: 46986414, rating: 1016, games: 1 },
      { pseudo: "Kaiba", avatar: null, rating: 984, games: 1 },
    ]);
    expect(board.some((row) => row.pseudo === "Tea")).toBe(false);
    expect(await readRating(server, idle)).toEqual({ rating: 1000, games: 0 });
  });

  it("deux duels qui se terminent en même temps entre les mêmes joueurs, dans les deux sens, comptent tous les deux sans interblocage", async () => {
    const [a, b] = [await newPlayer("Joey"), await newPlayer("Mai")];
    await Promise.all([rateDuel(server, { players: [a, b], winner: 0, reason: 1 }), rateDuel(server, { players: [b, a], winner: null, reason: 1 })]);
    const [ra, rb] = [await readRating(server, a), await readRating(server, b)];
    expect([ra.games, rb.games]).toEqual([2, 2]);
    expect(ra.rating + rb.rating).toBe(2000);
    expect(await matches(a)).toHaveLength(2);
  });

  it("garde le journal en ajout seul et refuse un gagnant qui n'a pas joué", async () => {
    const [a, b, c] = [await newPlayer("Bakura"), await newPlayer("Marik"), await newPlayer("Odion")];
    await rateDuel(server, { players: [a, b], winner: 1, reason: 0 });
    await expect(server`update yugioh.ranked_matches set reason = 1`).rejects.toThrow("permission denied");
    await expect(server`delete from yugioh.ranked_matches`).rejects.toThrow("permission denied");
    await expect(
      server`insert into yugioh.ranked_matches (player_a, player_b, winner, rating_a_before, rating_a_after, rating_b_before, rating_b_after, reason)
        values (${a}, ${b}, ${c}, 1000, 1000, 1000, 1000, 0)`,
    ).rejects.toThrow("ranked_matches_check");
  });

  it("un duel classé abandonné met à jour les deux classements une seule fois et s'enregistre en ligne", { timeout: 60_000 }, async () => {
    const players = [await newPlayer("Pegasus"), await newPlayer("Rex")];
    const clients = await Promise.all(
      players.map(async (id) => {
        await chooseStarter(server, id, "yugi");
        const socket = new WebSocket(url);
        const received: ServerMessage[] = [];
        socket.on("message", (data) => received.push(JSON.parse(String(data))));
        await once(socket, "open");
        const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
        send({ type: "auth", token: id });
        return { socket, received, send };
      }),
    );
    for (const client of clients) {
      client.send({ type: "ranked_queue" });
      await vi.waitFor(() => expect(client.received).toContainEqual({ type: "ranked_queue", waiting: true }));
    }
    await vi.waitFor(() => expect(clients.some((client) => client.received.some((msg) => msg.type === "question"))).toBe(true), { timeout: 30_000 });
    const [first, second] = clients;
    first.send({ type: "surrender" });
    await vi.waitFor(() => expect(first.received).toContainEqual({ type: "ranked_result", delta: -16, rating: 984 }));
    await vi.waitFor(() => expect(second.received).toContainEqual({ type: "ranked_result", delta: 16, rating: 1016 }));
    first.send({ type: "surrender" });
    await vi.waitFor(() => expect(first.received).toContainEqual({ type: "error", error: "aucun duel en cours" }));
    for (const client of clients) client.socket.close();

    expect(await readRating(server, players[0])).toEqual({ rating: 984, games: 1 });
    expect(await readRating(server, players[1])).toEqual({ rating: 1016, games: 1 });
    expect(await matches(players[0])).toEqual([{ winner: players[1], rating_a_before: 1000, rating_a_after: 984, rating_b_before: 1000, rating_b_after: 1016, reason: 0 }]);
    await vi.waitFor(async () => expect(await admin`select mode, won from yugioh.duel_results where user_id in ${admin(players)} order by won`).toEqual([{ mode: "online", won: false }, { mode: "online", won: true }]));
  });
});
