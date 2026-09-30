import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { solvedPuzzles, solvePuzzle } from "../src/puzzles.ts";
import { finishTutorial } from "../src/tutorial.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("progression des puzzles sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
  }, 180_000);

  afterAll(() => pg?.stop());

  it("un puzzle réussi rapporte un booster la première fois seulement, sans mêler les autres déblocages", async () => {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, "Tea");
    await admin`insert into yugioh.story_unlocks (user_id, unlock_id) values (${id}, 'card:3643300')`;

    expect(await solvePuzzle(server, id, "hache")).toBe(true);
    expect(await solvePuzzle(server, id, "hache")).toBe(false);
    expect(await solvePuzzle(server, id, "miroir")).toBe(true);

    expect(await solvedPuzzles(server, id)).toEqual(new Set(["hache", "miroir"]));
    const [{ pending }] = await admin`select pending from yugioh.booster_state where user_id = ${id}`;
    expect(pending).toBe(2);
  });

  it("le tutoriel gagné rapporte un booster la première fois seulement", async () => {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, "Joey");

    expect(await finishTutorial(server, id)).toBe(true);
    expect(await finishTutorial(server, id)).toBe(false);

    expect(await solvedPuzzles(server, id)).toEqual(new Set());
    const [{ pending }] = await admin`select pending from yugioh.booster_state where user_id = ${id}`;
    expect(pending).toBe(1);
  });
});
