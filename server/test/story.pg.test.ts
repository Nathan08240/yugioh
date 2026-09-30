import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import type { Rewards } from "../src/protocol.ts";
import { completeDuel, completedDuels, STORY_DUELS, type StoryDuel } from "../src/story.ts";
import { type Pg, startPostgres } from "./pg.ts";

const [weevil, mako, mai] = ["dk-weevil", "dk-mako", "dk-mai"].map((id) => STORY_DUELS.get(id) as StoryDuel);

describe("progression et récompenses sur Postgres jetable", () => {
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

  const holdings = async (userId: string) => ({
    pending: (await admin`select pending from yugioh.booster_state where user_id = ${userId}`)[0]?.pending ?? 0,
    cards: await admin`select card_code, quantity from yugioh.collection where user_id = ${userId}`,
    unlocks: (await admin`select unlock_id from yugioh.story_unlocks where user_id = ${userId}`).map((row) => row.unlock_id),
  });

  it("accorde les récompenses à la première victoire seulement, même rejouée", async () => {
    const id = await newPlayer("Yugi");
    expect(await completeDuel(server, id, weevil)).toEqual({ boosters: 1, cards: [] });
    expect(await completeDuel(server, id, mako)).toEqual({ boosters: 1, cards: [3643300] });
    expect(await completeDuel(server, id, mako)).toBeUndefined();
    expect(await completeDuel(server, id, weevil)).toBeUndefined();

    expect(await completedDuels(server, id)).toEqual(new Set(["dk-weevil", "dk-mako"]));
    expect(await holdings(id)).toEqual({ pending: 2, cards: [{ card_code: 3643300, quantity: 1 }], unlocks: ["card:3643300"] });
    expect(await admin`select card_code, rarity, quantity from yugioh.collection_rarities where user_id = ${id}`).toEqual([
      { card_code: 3643300, rarity: "common", quantity: 1 },
    ]);
  });

  it("n'accorde qu'une fois des victoires simultanées sur le même duel", async () => {
    const id = await newPlayer("Joey");
    await Promise.all(Array.from({ length: 10 }, () => server`select pg_sleep(0.2)`));
    const results: (Rewards | undefined)[] = await Promise.all(Array.from({ length: 10 }, () => completeDuel(server, id, mai)));
    expect(results.filter(Boolean)).toEqual([{ boosters: 2, cards: [12206212] }]);
    expect(await holdings(id)).toEqual({ pending: 2, cards: [{ card_code: 12206212, quantity: 1 }], unlocks: ["card:12206212"] });
  });
});
