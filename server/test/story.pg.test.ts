import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import type { StoryResult } from "../src/protocol.ts";
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
    unlocks: (await admin`select unlock_id from yugioh.story_unlocks where user_id = ${userId} order by unlock_id`).map((row) => row.unlock_id),
  });

  it("accorde les récompenses à la première victoire seulement, même rejouée", async () => {
    const id = await newPlayer("Yugi");
    expect(await completeDuel(server, id, weevil, 1)).toEqual({ rewards: { boosters: 1, cards: [] }, stars: 1, best: 1, starBooster: false });
    expect(await completeDuel(server, id, mako, 2)).toEqual({ rewards: { boosters: 1, cards: [3643300] }, stars: 2, best: 2, starBooster: false });
    expect(await completeDuel(server, id, mako, 1)).toEqual({ rewards: null, stars: 1, best: 2, starBooster: false, replays: 1 });
    expect(await completeDuel(server, id, weevil, 2)).toEqual({ rewards: null, stars: 2, best: 2, starBooster: false, replays: 2 });

    expect(await completedDuels(server, id)).toEqual(new Map([["dk-weevil", 2], ["dk-mako", 2]]));
    expect(await holdings(id)).toEqual({ pending: 2, cards: [{ card_code: 3643300, quantity: 1 }], unlocks: ["card:3643300"] });
    expect(await admin`select card_code, rarity, quantity from yugioh.collection_rarities where user_id = ${id}`).toEqual([
      { card_code: 3643300, rarity: "common", quantity: 1 },
    ]);
  });

  it("garde la meilleure note et n'accorde le booster des 3 étoiles qu'une fois par duel", async () => {
    const id = await newPlayer("Tea");
    expect(await completeDuel(server, id, weevil, 3)).toEqual({ rewards: { boosters: 1, cards: [] }, stars: 3, best: 3, starBooster: true });
    expect(await completeDuel(server, id, weevil, 2)).toMatchObject({ stars: 2, best: 3, starBooster: false });
    expect(await completeDuel(server, id, weevil, 3)).toMatchObject({ stars: 3, best: 3, starBooster: false });
    expect(await completeDuel(server, id, mako, 2)).toMatchObject({ best: 2, starBooster: false });
    expect(await completeDuel(server, id, mako, 3)).toMatchObject({ best: 3, starBooster: true, replays: 3 });

    expect(await completedDuels(server, id)).toEqual(new Map([["dk-weevil", 3], ["dk-mako", 3]]));
    // First wins 1 + 1, 3 stars 1 + 1, 3 replays 1.
    expect((await holdings(id)).pending).toBe(5);
    expect((await holdings(id)).unlocks).toEqual(["card:3643300", "stars:dk-mako", "stars:dk-weevil"]);
  });

  it("accorde un booster toutes les 3 victoires de rejeu, tous duels confondus", async () => {
    const id = await newPlayer("Tristan");
    await completeDuel(server, id, weevil, 1);
    await completeDuel(server, id, mako, 1);
    const replays = [];
    for (const duel of [weevil, mako, weevil, weevil, mako, mako, weevil]) replays.push((await completeDuel(server, id, duel, 1)).replays);
    expect(replays).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect((await holdings(id)).pending).toBe(2 + 2);
  });

  it("donne 1 étoile aux victoires enregistrées avant les étoiles", async () => {
    const id = await newPlayer("Bakura");
    await admin`insert into yugioh.story_duels (user_id, duel_id) values (${id}, 'dk-weevil')`;
    expect(await completedDuels(server, id)).toEqual(new Map([["dk-weevil", 1]]));
    expect(await completeDuel(server, id, weevil, 2)).toEqual({ rewards: null, stars: 2, best: 2, starBooster: false, replays: 1 });
  });

  it("n'accorde qu'une fois des victoires simultanées sur le même duel", async () => {
    const id = await newPlayer("Joey");
    await Promise.all(Array.from({ length: 10 }, () => server`select pg_sleep(0.2)`));
    const results: StoryResult[] = await Promise.all(Array.from({ length: 10 }, () => completeDuel(server, id, mai, 3)));
    expect(results.filter((result) => result.rewards)).toEqual([{ rewards: { boosters: 2, cards: [12206212] }, stars: 3, best: 3, starBooster: true }]);
    expect(results.filter((result) => result.starBooster)).toHaveLength(1);
    // The 9 others are replays: 3 boosters.
    expect(await holdings(id)).toEqual({ pending: 2 + 1 + 3, cards: [{ card_code: 12206212, quantity: 1 }], unlocks: ["card:12206212", "stars:dk-mai"] });
  });
});
