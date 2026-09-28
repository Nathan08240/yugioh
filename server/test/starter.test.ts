import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { chooseStarter, starterCards } from "../src/starter.ts";
import { hasDocker, type Pg, startPostgres } from "./pg.ts";

describe.skipIf(!hasDocker())("choix du starter sur Postgres jetable", () => {
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

  it("ajoute les cartes à la collection, crée le deck et le rend actif", async () => {
    const id = await newPlayer("Yugi");
    const codes = starterCards("yugi");

    expect(await chooseStarter(server, id, "yugi")).toBe(true);

    const collection = await admin<{ card_code: number; quantity: number }[]>`
      select card_code, quantity from yugioh.collection where user_id = ${id} order by card_code`;
    expect(collection).toEqual([...codes].sort((a, b) => a - b).map((code) => ({ card_code: code, quantity: 1 })));

    const [deck] = await admin<{ name: string; main_deck: number[] }[]>`
      select name, main_deck from yugioh.decks where user_id = ${id}`;
    expect(deck).toEqual({ name: "Starter Yugi", main_deck: codes });

    const [profile] = await admin<{ active_deck_id: number }[]>`select active_deck_id from yugioh.profiles where user_id = ${id}`;
    expect(profile.active_deck_id).not.toBeNull();
  });

  it("refuse un deuxième choix", async () => {
    const id = await newPlayer("Kaiba");
    expect(await chooseStarter(server, id, "kaiba")).toBe(true);
    expect(await chooseStarter(server, id, "yugi")).toBe(false);

    const decks = await admin`select name from yugioh.decks where user_id = ${id}`;
    expect(decks).toEqual([{ name: "Starter Kaiba" }]);
  });

  it("ne consomme qu'une fois un double envoi simultané", async () => {
    const id = await newPlayer("Joey");
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => chooseStarter(server, id, "yugi")));

    expect(results.filter((result) => result.status === "fulfilled" && result.value === true)).toHaveLength(1);
    const decks = await admin`select name from yugioh.decks where user_id = ${id}`;
    expect(decks).toHaveLength(1);
  });
});
