import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { POOL } from "../src/pool.ts";
import { dbProfileStore, type ProfileStore } from "../src/profile.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("avatar et carte favorite sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let store: ProfileStore;
  const [owned, other] = [...POOL];

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    store = dbProfileStore(pg.server);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function player(pseudo: string, cards: number[] = []) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    for (const code of cards) await admin`insert into yugioh.collection (user_id, card_code, quantity) values (${id}, ${code}, 1)`;
    return id;
  }

  it("part sans avatar ni favorite, un profil inconnu aussi", async () => {
    const alice = await player("Alice");
    expect(await store.profileCards(alice)).toEqual({ avatar: null, favorite: null });
    expect(await store.profileCards("00000000-0000-0000-0000-000000000000")).toEqual({ avatar: null, favorite: null });
  });

  it("garde l'avatar et la favorite d'une carte possédée, chacun de son côté", async () => {
    const bob = await player("Bob", [owned, other]);
    expect(await store.setProfileCard(bob, "avatar", owned)).toBe(true);
    expect(await store.profileCards(bob)).toEqual({ avatar: owned, favorite: null });
    expect(await store.setProfileCard(bob, "favorite", other)).toBe(true);
    expect(await store.setProfileCard(bob, "avatar", other)).toBe(true);
    expect(await store.profileCards(bob)).toEqual({ avatar: other, favorite: other });
  });

  it("refuse une carte non possédée, ou possédée par un autre joueur, sans rien changer", async () => {
    const carol = await player("Carol", [owned]);
    await player("Dave", [other]);
    expect(await store.setProfileCard(carol, "avatar", other)).toBe(false);
    expect(await store.setProfileCard(carol, "favorite", 999_999_999)).toBe(false);
    expect(await store.profileCards(carol)).toEqual({ avatar: null, favorite: null });
  });

  it("garde l'affichage d'une carte qui n'est plus possédée", async () => {
    const eve = await player("Eve", [owned]);
    await store.setProfileCard(eve, "favorite", owned);
    await admin`delete from yugioh.collection where user_id = ${eve}`;
    expect(await store.profileCards(eve)).toEqual({ avatar: null, favorite: owned });
  });
});
