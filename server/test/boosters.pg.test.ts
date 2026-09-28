import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditBoosters, FREE_BOOSTER_HOURS, openBooster } from "../src/boosters.ts";
import { createProfile, type Db } from "../src/db.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("ouverture des boosters sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
  }, 180_000);

  afterAll(() => pg?.stop());

  async function newPlayer(pseudo: string): Promise<string> {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, pseudo);
    return id;
  }

  const state = async (userId: string) =>
    (await admin<{ hours: number; pending: number }[]>`
      select round(extract(epoch from next_free_at - now()) / 3600)::int as hours, pending
      from yugioh.booster_state where user_id = ${userId}`)[0];

  it("ouvre le booster gratuit d'un nouveau joueur, remplit la collection et relance le timer", async () => {
    const id = await newPlayer("Yugi");
    const cards = await openBooster(server, id, "LOB");

    const [opening] = await admin`select set_code, source, cards from yugioh.booster_openings where user_id = ${id}`;
    const collection = await admin<{ card_code: number; quantity: number }[]>`
      select card_code, quantity from yugioh.collection where user_id = ${id}`;
    expect(opening).toEqual({ set_code: "LOB", source: "free", cards: cards.map((card) => card.code) });
    expect(collection.reduce((sum, row) => sum + row.quantity, 0)).toBe(9);
    expect(await state(id)).toEqual({ hours: FREE_BOOSTER_HOURS, pending: 0 });
    await expect(openBooster(server, id, "LOB")).rejects.toThrow("aucun booster disponible");

    await admin`update yugioh.booster_state set next_free_at = now() - interval '1 second' where user_id = ${id}`;
    await openBooster(server, id, "MRD");
    expect(await state(id)).toEqual({ hours: FREE_BOOSTER_HOURS, pending: 0 });
  });

  it("ouvre les boosters gagnés dans le set choisi une fois le gratuit pris", async () => {
    const id = await newPlayer("Joey");
    await creditBoosters(server, id, 2);
    await openBooster(server, id, "SOD");
    await openBooster(server, id, "FET");
    await openBooster(server, id, "RDS");

    const sources = await admin`select set_code, source from yugioh.booster_openings where user_id = ${id} order by id`;
    expect(sources.map((row) => `${row.set_code} ${row.source}`)).toEqual(["SOD free", "FET earned", "RDS earned"]);
    expect((await state(id)).pending).toBe(0);
    await expect(openBooster(server, id, "SOD")).rejects.toThrow("aucun booster disponible");
    await expect(creditBoosters(server, id, 0)).rejects.toThrow("nombre de boosters invalide");
  });

  it("refuse un set qui n'est pas un booster", async () => {
    const id = await newPlayer("Kaiba");
    await expect(openBooster(server, id, "SDK")).rejects.toThrow("booster inconnu");
  });

  it("ne consomme qu'une fois un même droit ouvert plusieurs fois en même temps", async () => {
    // Sans ligne booster_state, avec le gratuit dû, avec un seul booster gagné.
    const newcomer = await newPlayer("Mai");
    const free = await newPlayer("Marik");
    const earned = await newPlayer("Bakura");
    await admin`insert into yugioh.booster_state (user_id) values (${free})`;
    await creditBoosters(server, earned, 1);
    await admin`update yugioh.booster_state set next_free_at = now() + interval '1 hour' where user_id = ${earned}`;

    // Connexions ouvertes d'avance pour que les ouvertures se chevauchent vraiment.
    await Promise.all(Array.from({ length: 10 }, () => server`select pg_sleep(0.2)`));
    for (const id of [newcomer, free, earned]) {
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => openBooster(server, id, "LOB")));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const [{ count }] = await admin`select count(*)::int from yugioh.booster_openings where user_id = ${id}`;
      expect(count).toBe(1);
    }
  });
});
