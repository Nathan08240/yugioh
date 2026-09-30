import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { createProfile, type Db } from "../src/db.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import type { ClientMessage, ServerMessage } from "../src/protocol.ts";
import { abandonRun, lastRun, recordRunDuel, saveRunDeck, SEALED_PACKS, startRun } from "../src/sealed.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { chooseStarter } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("mode Scellé sur Postgres jetable", () => {
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

  // A session whose reserve is Yugi's starter deck, with its deck validated: ready to play.
  async function playing(pseudo: string): Promise<{ id: string; run: number }> {
    const id = await newPlayer(pseudo);
    const run = await startRun(server, id);
    await admin`update yugioh.sealed_runs set pool = ${YUGI}, rarities = ${YUGI.map(() => "common")} where id = ${run.id}`;
    expect(await saveRunDeck(server, id, YUGI, [])).toMatchObject({ status: "playing", main: YUGI });
    return { id, run: run.id };
  }

  const pending = async (userId: string) => (await admin<{ pending: number }[]>`select pending from yugioh.booster_state where user_id = ${userId}`)[0]?.pending ?? 0;

  it("ouvre 6 boosters dans une seule session en cours, sans rien ajouter à la collection", async () => {
    const id = await newPlayer("Yugi");
    expect(await lastRun(server, id)).toBeUndefined();
    const runs = await Promise.all(Array.from({ length: 5 }, () => startRun(server, id)));

    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    expect(runs[0]).toMatchObject({ status: "building", wins: 0, losses: 0, main: null, boosters: 0 });
    expect(runs[0].pool).toHaveLength(SEALED_PACKS * 9);
    const [{ count }] = await admin`select count(*)::int from yugioh.sealed_runs where user_id = ${id}`;
    expect(count).toBe(1);
    expect(await admin`select 1 from yugioh.collection where user_id = ${id}`).toHaveLength(0);
    await expect(admin`insert into yugioh.sealed_runs (user_id, set_code, pool, rarities) values (${id}, 'LOB', '{1}', '{common}')`).rejects.toThrow("sealed_runs_current_key");

    await abandonRun(server, id);
    const next = await startRun(server, id);
    expect(next.id).not.toBe(runs[0].id);
  });

  it("refuse un deck hors de la réserve et ne le fixe qu'une fois", async () => {
    const id = await newPlayer("Kaiba");
    const run = await startRun(server, id);
    await admin`update yugioh.sealed_runs set pool = ${YUGI}, rarities = ${YUGI.map(() => "common")} where id = ${run.id}`;

    expect(await saveRunDeck(server, id, [...YUGI.slice(1), KAIBA[0]], [])).toMatch("plus d'exemplaires que dans la réserve");
    expect(await saveRunDeck(server, id, YUGI.slice(1), [])).toMatch("40 à 60 cartes");
    expect(await lastRun(server, id)).toMatchObject({ status: "building", main: null });
    expect(await saveRunDeck(server, id, YUGI, [])).toMatchObject({ status: "playing" });
    expect(await saveRunDeck(server, id, YUGI, [])).toBe("aucun deck Scellé à construire");
  });

  it("finit à 3 victoires avec 4 boosters, crédités une seule fois même en parallèle", async () => {
    const { id, run } = await playing("Joey");
    const results = await Promise.all(Array.from({ length: 6 }, () => recordRunDuel(server, id, run, true)));

    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await lastRun(server, id)).toMatchObject({ status: "done", wins: 3, losses: 0, boosters: 4 });
    expect(await pending(id)).toBe(4);
    expect(await recordRunDuel(server, id, run, false)).toBeUndefined();
    expect(await pending(id)).toBe(4);
  });

  it("finit à 2 défaites avec un booster par victoire, rien sans victoire, rien après abandon", async () => {
    const one = await playing("Mai");
    for (const won of [false, true, false]) await recordRunDuel(server, one.id, one.run, won);
    expect(await lastRun(server, one.id)).toMatchObject({ status: "done", wins: 1, losses: 2, boosters: 1 });
    expect(await pending(one.id)).toBe(1);

    const none = await playing("Marik");
    await recordRunDuel(server, none.id, none.run, false);
    expect(await recordRunDuel(server, none.id, none.run, false)).toMatchObject({ status: "done", boosters: 0 });
    expect(await pending(none.id)).toBe(0);

    const left = await playing("Bakura");
    await recordRunDuel(server, left.id, left.run, true);
    expect(await abandonRun(server, left.id)).toMatchObject({ status: "abandoned", wins: 1, boosters: 0 });
    expect(await recordRunDuel(server, left.id, left.run, true)).toBeUndefined();
    expect(await pending(left.id)).toBe(0);
  });

  it("joue la session par le serveur de partie : deck refusé hors réserve, duel perdu compté", { timeout: 30_000 }, async () => {
    const id = await newPlayer("Tea");
    await chooseStarter(server, id, "kaiba");
    const socket = new WebSocket(url);
    const received: ServerMessage[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    // The bot may greet at any time: only the last message of the type counts.
    const last = (type = "sealed") => received.findLast((msg) => msg.type === type);
    send({ type: "auth", token: id });
    send({ type: "sealed_duel" });
    await vi.waitFor(() => expect(last("error")).toEqual({ type: "error", error: "aucun duel Scellé à jouer" }));
    send({ type: "sealed_start" });
    await vi.waitFor(() => expect(last()).toMatchObject({ type: "sealed", run: { status: "building" } }));
    const run = (last() as Extract<ServerMessage, { type: "sealed" }>).run;
    await admin`update yugioh.sealed_runs set pool = ${YUGI}, rarities = ${YUGI.map(() => "common")} where id = ${run?.id ?? 0}`;

    send({ type: "sealed_deck", main: KAIBA, extra: [] });
    await vi.waitFor(() => expect(last("error")).toMatchObject({ error: expect.stringContaining("la réserve") }));
    send({ type: "sealed_deck", main: YUGI, extra: [] });
    await vi.waitFor(() => expect(last()).toMatchObject({ type: "sealed", run: { status: "playing" } }));
    send({ type: "sealed_duel" });
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    send({ type: "surrender" });
    await vi.waitFor(() => expect(last()).toMatchObject({ type: "sealed", run: { status: "playing", wins: 0, losses: 1 } }));
    socket.close();

    const rows = await admin`select mode, level, won, deck_id from yugioh.duel_results where user_id = ${id}`;
    expect(rows).toEqual([{ mode: "bot", level: "normal", won: false, deck_id: null }]);
  });
});
