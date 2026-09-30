import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { createProfile, type Db } from "../src/db.ts";
import type { ClientMessage, ServerMessage } from "../src/protocol.ts";
import { enterSeason, rateDuel, readLeaderboard, readRanked, readRating } from "../src/ranked.ts";
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
    expect(await readRating(server, a)).toEqual({ rating: 1000, games: 0, seasonGames: 0 });

    expect(await rateDuel(server, { players: [a, b], winner: 0, reason: 1 }, "2026-10")).toEqual([
      { before: 1000, after: 1016 },
      { before: 1000, after: 984 },
    ]);
    expect(await readRating(server, a)).toEqual({ rating: 1016, games: 1, seasonGames: 1 });
    expect(await readRating(server, b)).toEqual({ rating: 984, games: 1, seasonGames: 1 });
    expect(await matches(a)).toEqual([{ winner: a, rating_a_before: 1000, rating_a_after: 1016, rating_b_before: 1000, rating_b_after: 984, reason: 1 }]);

    const board = await readLeaderboard(server, "2026-10");
    expect(board).toEqual([
      { pseudo: "Yugi", avatar: 46986414, rating: 1016, games: 1 },
      { pseudo: "Kaiba", avatar: null, rating: 984, games: 1 },
    ]);
    expect(board.some((row) => row.pseudo === "Tea")).toBe(false);
    expect(await readRating(server, idle)).toEqual({ rating: 1000, games: 0, seasonGames: 0 });
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

    expect(await readRating(server, players[0])).toEqual({ rating: 984, games: 1, seasonGames: 1 });
    expect(await readRating(server, players[1])).toEqual({ rating: 1016, games: 1, seasonGames: 1 });
    expect(await matches(players[0])).toEqual([{ winner: players[1], rating_a_before: 1000, rating_a_after: 984, rating_b_before: 1000, rating_b_after: 1016, reason: 0 }]);
    await vi.waitFor(async () => expect(await admin`select mode, won from yugioh.duel_results where user_id in ${admin(players)} order by won`).toEqual([{ mode: "online", won: false }, { mode: "online", won: true }]));
  });

  // A player whose last season is `season`, ended at `rating` after `games` duels, with 10 duels in earlier seasons.
  async function veteran(pseudo: string, season: string, rating: number, games: number): Promise<string> {
    const id = await newPlayer(pseudo);
    await admin`update yugioh.profiles set season = ${season}, rating = ${rating}, season_games = ${games}, ranked_games = ${games + 10} where user_id = ${id}`;
    return id;
  }
  const pending = async (id: string) => (await admin<{ pending: number }[]>`select pending from yugioh.booster_state where user_id = ${id}`)[0]?.pending ?? 0;
  const seasons = (id: string) => admin`select season, final_rating, games, boosters from yugioh.ranked_seasons where user_id = ${id}`;

  it("récompense la saison écoulée selon le palier du classement final, puis rapproche le classement de 1000 de moitié", async () => {
    const cases = [
      [1450, 5, 5, 1225],
      [1400, 7, 5, 1200],
      [1399, 9, 3, 1200],
      [1200, 5, 3, 1100],
      [1199, 5, 1, 1100],
      [1000, 6, 1, 1000],
      [999, 5, 0, 1000],
      [800, 6, 0, 900],
    ];
    for (const [index, [rating, games, boosters, next]] of cases.entries()) {
      const id = await veteran(`Palier${index}`, "2026-09", rating, games);
      expect(await enterSeason(server, id, "2026-10")).toEqual({ rating: next, games: games + 10, seasonGames: 0 });
      expect(await pending(id)).toBe(boosters);
      expect(await seasons(id)).toEqual([{ season: "2026-09", final_rating: rating, games, boosters }]);
    }
  });

  it("ne récompense pas une saison de moins de 5 duels, mais rapproche quand même le classement de 1000", async () => {
    const id = await veteran("Peu", "2026-09", 1500, 4);
    expect(await enterSeason(server, id, "2026-10")).toEqual({ rating: 1250, games: 14, seasonGames: 0 });
    expect(await pending(id)).toBe(0);
    expect(await seasons(id)).toEqual([{ season: "2026-09", final_rating: 1500, games: 4, boosters: 0 }]);
  });

  it("ne passe qu'une fois à la nouvelle saison, même en parallèle, et le duel classé du nouveau mois compte après ce passage", async () => {
    const id = await veteran("Parallele", "2026-09", 1400, 5);
    const other = await newPlayer("Adverse");
    await Promise.all([
      ...Array.from({ length: 4 }, () => enterSeason(server, id, "2026-10")),
      rateDuel(server, { players: [id, other], winner: 0, reason: 1 }, "2026-10"),
    ]);
    await enterSeason(server, id, "2026-10");
    expect(await pending(id)).toBe(5);
    expect(await seasons(id)).toHaveLength(1);
    // 1400 recentered to 1200, then a win against 1000.
    expect(await readRating(server, id)).toEqual({ rating: 1208, games: 16, seasonGames: 1 });
    expect(await matches(id)).toEqual([{ winner: id, rating_a_before: 1200, rating_a_after: 1208, rating_b_before: 1000, rating_b_after: 992, reason: 1 }]);
  });

  it("fait entrer un joueur d'avant les saisons dans la saison en cours, sans récompense ni remise vers le centre", async () => {
    const id = await newPlayer("Ancien");
    await admin`update yugioh.profiles set rating = 1500, ranked_games = 30 where user_id = ${id}`;
    expect(await enterSeason(server, id, "2026-10")).toEqual({ rating: 1500, games: 30, seasonGames: 0 });
    expect(await pending(id)).toBe(0);
    expect(await seasons(id)).toEqual([]);
    expect(await admin`select season from yugioh.profiles where user_id = ${id}`).toEqual([{ season: "2026-10" }]);
    // A season entered without playing: no reward, the rating still recentered.
    expect(await enterSeason(server, id, "2026-11")).toEqual({ rating: 1250, games: 30, seasonGames: 0 });
    expect(await seasons(id)).toEqual([{ season: "2026-10", final_rating: 1500, games: 0, boosters: 0 }]);
  });

  it("montre la saison en cours, les 10 meilleurs de la précédente et le dernier résultat du joueur", async () => {
    const now = new Date("2030-06-10T12:00:00Z");
    const best = await veteran("Premier", "2030-05", 1500, 8);
    const second = await veteran("Second", "2030-05", 1300, 5);
    await veteran("SansDuel", "2030-05", 1600, 0);
    for (let index = 0; index < 10; index++) await veteran(`Suivant${index}`, "2030-05", 1000 + index, 1);
    const fresh = await newPlayer("Nouveau");
    await enterSeason(server, second, "2030-06");
    const top = [
      { pseudo: "Premier", avatar: null, rating: 1500, games: 8 },
      { pseudo: "Second", avatar: null, rating: 1300, games: 5 },
      ...[9, 8, 7, 6, 5, 4, 3, 2].map((index) => ({ pseudo: `Suivant${index}`, avatar: null, rating: 1000 + index, games: 1 })),
    ];
    // The best player of May has not entered June yet: May still counts their profile.
    expect(await readRanked(server, fresh, now)).toEqual({
      rating: 1000,
      games: 0,
      seasonGames: 0,
      season: "2030-06",
      daysLeft: 21,
      leaderboard: [],
      previousSeason: "2030-05",
      previousLeaderboard: top,
      lastResult: null,
    });
    await rateDuel(server, { players: [best, second], winner: 0, reason: 1 }, "2030-06");
    const view = await readRanked(server, best, now);
    expect(view).toMatchObject({ rating: 1262, games: 19, seasonGames: 1, previousLeaderboard: top, lastResult: { season: "2030-05", rating: 1500, games: 8, boosters: 5 } });
    expect(view.leaderboard).toEqual([
      { pseudo: "Premier", avatar: null, rating: 1262, games: 1 },
      { pseudo: "Second", avatar: null, rating: 1138, games: 1 },
    ]);
  });
});
