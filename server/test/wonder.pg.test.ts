import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import type { WonderView } from "../src/protocol.ts";
import { dbWonderStore, type WonderStore } from "../src/wonder.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("pioche miracle sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let store: WonderStore;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    store = dbWonderStore(pg.server);
    // Connexions ouvertes d'avance pour que les appels parallèles se chevauchent vraiment.
    await Promise.all(Array.from({ length: 10 }, () => pg.server`select pg_sleep(0.2)`));
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function player(pseudo: string) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    return id;
  }

  const rows = (userId: string) => admin`select * from yugioh.wonder_picks where user_id = ${userId}`;
  const cardsOf = (view: WonderView | string) => (view as Extract<WonderView, { cards: unknown }>).cards;

  it("tire une fois par jour, et rend le même tirage après reconnexion ou en parallèle", async () => {
    const id = await player("Yugi");
    expect(await store.wonder(id)).toEqual({ status: "available" });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.wonderDraw(id)));
    expect(results[0].status).toBe("drawn");
    expect(cardsOf(results[0])).toHaveLength(5);
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await store.wonder(id)).toEqual(results[0]);
    expect(await store.wonderDraw(id)).toEqual(results[0]);
    expect(await rows(id)).toHaveLength(1);
  });

  it("ajoute à la collection la carte choisie, avec sa rareté, une seule fois même en parallèle", async () => {
    const id = await player("Joey");
    const drawn = await store.wonderDraw(id);
    const results = await Promise.all(Array.from({ length: 10 }, () => store.wonderPick(id, 2)));
    const picked = results.filter((result) => typeof result !== "string");
    expect(picked).toHaveLength(1);
    expect(results.filter((result) => result === "carte déjà choisie")).toHaveLength(9);

    const [{ shuffle }] = await rows(id);
    const card = cardsOf(drawn)[shuffle[2]];
    expect(picked[0]).toEqual({ status: "picked", cards: cardsOf(drawn), shuffle, picked: 2 });
    expect(await store.wonder(id)).toEqual(picked[0]);
    expect(await admin`select card_code as code, quantity from yugioh.collection where user_id = ${id}`).toEqual([{ code: card.code, quantity: 1 }]);
    expect(await admin`select card_code as code, rarity, quantity from yugioh.collection_rarities where user_id = ${id}`).toEqual([
      { code: card.code, rarity: card.rarity, quantity: 1 },
    ]);
    expect(await store.wonderDraw(id)).toEqual(picked[0]);
    expect(await store.wonderPick(id, 0)).toBe("carte déjà choisie");
  });

  it("refuse un choix sans tirage du jour, et repart à zéro le lendemain (date de Paris)", async () => {
    const id = await player("Kaiba");
    expect(await store.wonderPick(id, 0)).toBe("aucune pioche miracle en cours");
    const first = await store.wonderDraw(id);
    await store.wonderPick(id, 0);
    const [{ today }] = await admin`select (now() at time zone 'Europe/Paris')::date::text as today`;
    expect((await rows(id))[0].day.toISOString().slice(0, 10)).toBe(today);

    await admin`update yugioh.wonder_picks set day = day - 1 where user_id = ${id}`;
    expect(await store.wonder(id)).toEqual({ status: "available" });
    expect(await store.wonderPick(id, 0)).toBe("aucune pioche miracle en cours");
    const second = await store.wonderDraw(id);
    expect(second.status).toBe("drawn");
    expect(await store.wonderPick(id, 4)).toMatchObject({ status: "picked", picked: 4 });
    expect(await rows(id)).toHaveLength(2);
    expect(first.status).toBe("drawn");
    const [{ total }] = await admin`select sum(quantity)::int as total from yugioh.collection where user_id = ${id}`;
    expect(total).toBe(2);
  });

  it("supprime le tirage avec le profil, le serveur ne peut pas modifier les cartes tirées", async () => {
    const id = await player("Mai");
    await store.wonderDraw(id);
    await expect(pg.server`update yugioh.wonder_picks set cards = '{1,2,3,4,5}' where user_id = ${id}`).rejects.toThrow();
    await expect(pg.server`delete from yugioh.wonder_picks where user_id = ${id}`).rejects.toThrow();
    await admin`delete from yugioh.profiles where user_id = ${id}`;
    expect(await rows(id)).toHaveLength(0);
  });
});
