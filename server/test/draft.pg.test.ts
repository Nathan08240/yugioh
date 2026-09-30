import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { createProfile, type Db } from "../src/db.ts";
import { YUGI } from "../src/decks.ts";
import { dbDraftStore, draftOpponent, pickDraftCard, startDraftRun } from "../src/draft.ts";
import type { ClientMessage, DraftRun, ServerMessage } from "../src/protocol.ts";
import { startRun } from "../src/sealed.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { chooseStarter } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("mode Draft sur Postgres jetable", () => {
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

  const counts = async (runId: number) => {
    const [row] = await admin<{ pool: number; bots: number[] }[]>`
      select cardinality(pool) as pool, array(select jsonb_array_length(b) from jsonb_array_elements(bots) b) as bots
      from yugioh.draft_runs where id = ${runId}`;
    return [row.pool, ...row.bots];
  };

  it("garde une seule session Draft en cours, indépendante du Scellé, sans rien ajouter à la collection", async () => {
    const id = await newPlayer("Yugi");
    await startRun(server, id);
    const runs = await Promise.all(Array.from({ length: 5 }, () => startDraftRun(server, id)));

    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    expect(runs[0]).toMatchObject({ status: "drafting", round: 1, pool: [], main: null, wins: 0, boosters: 0 });
    expect(runs[0].pack).toHaveLength(9);
    await expect(admin`insert into yugioh.draft_runs (user_id, set_code, packs, bots) values (${id}, 'LOB', '[]', '[]')`).rejects.toThrow("draft_runs_current_key");
    const store = dbDraftStore(server);
    expect(await store.abandonDraft(id)).toMatchObject({ status: "abandoned" });
    expect((await store.startDraft(id)).id).not.toBe(runs[0].id);
    expect(await admin`select status from yugioh.sealed_runs where user_id = ${id}`).toEqual([{ status: "building" }]);
    expect(await admin`select 1 from yugioh.collection where user_id = ${id}`).toHaveLength(0);
  });

  it("enregistre chaque choix une fois, même en parallèle, refuse un choix invalide et reprend au même booster", async () => {
    const id = await newPlayer("Kaiba");
    const run = await startDraftRun(server, id);
    expect(await pickDraftCard(server, id, 9)).toBe("carte absente du booster");
    const picks = await Promise.all([0, 0, 0].map((index) => pickDraftCard(server, id, index)));
    expect(picks.map((pick) => (pick as DraftRun).pool.length).sort()).toEqual([1, 2, 3]);

    const resumed = await dbDraftStore(server).draftRun(id);
    expect(resumed).toMatchObject({ id: run.id, round: 1, status: "drafting" });
    expect(resumed?.pack).toHaveLength(6);
    expect(await counts(run.id)).toEqual([3, 3, 3, 3]);
    expect(await pickDraftCard(server, id, 6)).toBe("carte absente du booster");
    expect(await pickDraftCard(server, await newPlayer("Joey"), 0)).toBe("aucun draft en cours");
  });

  it("finit avec 54 cartes pour chacun, puis se joue comme le Scellé", async () => {
    const id = await newPlayer("Mai");
    const store = dbDraftStore(server);
    let run = await startDraftRun(server, id);
    for (let pick = 0; pick < 54; pick++) run = (await pickDraftCard(server, id, run.pack.length - 1)) as DraftRun;

    expect(run).toMatchObject({ status: "building", round: 6, pack: [] });
    expect(await counts(run.id)).toEqual([54, 54, 54, 54]);
    expect(await pickDraftCard(server, id, 0)).toBe("aucun draft en cours");
    const bot = await draftOpponent(server, run.id);
    expect(bot.main.length + bot.extra.length).toBeGreaterThan(30);

    await admin`update yugioh.draft_runs set pool = ${YUGI}, rarities = ${YUGI.map(() => "common")} where id = ${run.id}`;
    expect(await store.saveDraftDeck(id, YUGI.slice(1), [])).toMatch("40 à 60 cartes");
    expect(await store.saveDraftDeck(id, YUGI, [])).toMatchObject({ status: "playing" });
    for (let duel = 0; duel < 3; duel++) await store.draftResult(id, run.id, true);
    expect(await store.draftRun(id)).toMatchObject({ status: "done", wins: 3, boosters: 4 });
    const [{ pending }] = await admin`select pending from yugioh.booster_state where user_id = ${id}`;
    expect(pending).toBe(4);
  });

  it("joue un draft complet par le serveur de partie, avec reconnexion, jusqu'au duel compté", { timeout: 60_000 }, async () => {
    const id = await newPlayer("Tea");
    await chooseStarter(server, id, "kaiba");
    const connect = async () => {
      const socket = new WebSocket(url);
      const received: ServerMessage[] = [];
      socket.on("message", (data) => received.push(JSON.parse(String(data))));
      await once(socket, "open");
      const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
      send({ type: "auth", token: id });
      const last = <T extends ServerMessage["type"]>(type: T) => received.findLast((msg) => msg.type === type) as Extract<ServerMessage, { type: T }> | undefined;
      return { socket, send, last, received };
    };

    let client = await connect();
    client.send({ type: "draft_duel" });
    await vi.waitFor(() => expect(client.last("error")).toEqual({ type: "error", error: "aucun duel Draft à jouer" }));
    client.send({ type: "draft_start" });
    await vi.waitFor(() => expect(client.last("draft")?.run).toMatchObject({ status: "drafting", round: 1 }));
    client.send({ type: "draft_pick", index: 0 });
    await vi.waitFor(() => expect(client.last("draft")?.run?.pool).toHaveLength(1));
    const pack = client.last("draft")?.run?.pack;
    client.socket.close();

    client = await connect();
    client.send({ type: "draft" });
    await vi.waitFor(() => expect(client.last("draft")?.run?.pack).toEqual(pack));
    for (let pick = 1; pick < 54; pick++) {
      client.send({ type: "draft_pick", index: 0 });
      await vi.waitFor(() => expect(client.last("draft")?.run?.pool).toHaveLength(pick + 1));
    }
    const run = client.last("draft")?.run;
    expect(run).toMatchObject({ status: "building", pack: [] });
    await admin`update yugioh.draft_runs set pool = ${YUGI}, rarities = ${YUGI.map(() => "common")} where id = ${run?.id ?? 0}`;
    client.send({ type: "draft_deck", main: YUGI, extra: [] });
    await vi.waitFor(() => expect(client.last("draft")?.run).toMatchObject({ status: "playing" }));
    client.send({ type: "draft_duel" });
    await vi.waitFor(() => expect(client.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    client.send({ type: "surrender" });
    await vi.waitFor(() => expect(client.last("draft")?.run).toMatchObject({ status: "playing", wins: 0, losses: 1 }));
    client.send({ type: "rematch" });
    await vi.waitFor(() => expect(client.last("error")?.error).toBe("le duel suivant se lance depuis l'écran Draft"));
    client.socket.close();
  });
});
