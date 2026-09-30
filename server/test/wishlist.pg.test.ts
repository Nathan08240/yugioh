import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { POOL } from "../src/pool.ts";
import { dbWishStore, WISH_MAX, type WishStore } from "../src/wishlist.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("liste de souhaits sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let store: WishStore;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    store = dbWishStore(pg.server);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function player(pseudo: string) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    return id;
  }

  it("garde les souhaits par joueur, dans l'ordre d'ajout, sans doublon", async () => {
    const [a, b, c] = [...POOL];
    const alice = await player("Alice");
    const bob = await player("Bob");
    expect(await store.wishlist(alice)).toEqual([]);
    await store.addWish(alice, b);
    await store.addWish(alice, a);
    expect(await store.addWish(alice, b)).toBe(true);
    await store.addWish(bob, c);
    expect(await store.wishlist(alice)).toEqual([b, a]);
    expect(await store.wishlist(bob)).toEqual([c]);
    await store.removeWish(alice, b);
    await store.removeWish(alice, b);
    expect(await store.wishlist(alice)).toEqual([a]);
  });

  it("refuse le souhait au-delà du maximum, même en parallèle, mais garde un souhait déjà présent", async () => {
    const codes = [...POOL].slice(0, WISH_MAX + 5);
    const carol = await player("Carol");
    const results = await Promise.all(codes.map((code) => store.addWish(carol, code)));
    expect(results.filter(Boolean)).toHaveLength(WISH_MAX);
    const wished = await store.wishlist(carol);
    expect(wished).toHaveLength(WISH_MAX);
    expect(await store.addWish(carol, wished[0])).toBe(true);
    expect(await store.addWish(carol, codes.find((code) => !wished.includes(code)) as number)).toBe(false);
  });

  it("supprime la liste avec le profil, le serveur n'a pas le droit de modifier un souhait", async () => {
    const dave = await player("Dave");
    await store.addWish(dave, [...POOL][0]);
    await admin`delete from yugioh.profiles where user_id = ${dave}`;
    expect(await admin`select 1 from yugioh.wishlist where user_id = ${dave}`).toHaveLength(0);
    await expect(pg.server`update yugioh.wishlist set card_code = 1`).rejects.toThrow();
  });
});
