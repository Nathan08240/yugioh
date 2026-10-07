import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { solvedLessons, solveLesson } from "../src/lessons.ts";
import { LESSON_POINTS } from "../src/protocol.ts";
import { solvedPuzzles } from "../src/puzzles.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("progression des leçons sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
  }, 180_000);

  afterAll(() => pg?.stop());

  it("une leçon gagnée rapporte des points de collection la première fois seulement, sans mêler les puzzles", async () => {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, "Tea");
    await admin`insert into yugioh.story_unlocks (user_id, unlock_id) values (${id}, 'puzzle:hache')`;

    expect(await solveLesson(server, id, "fusion")).toBe(true);
    expect(await solveLesson(server, id, "fusion")).toBe(false);
    expect(await solveLesson(server, id, "chaine")).toBe(true);

    expect(await solvedLessons(server, id)).toEqual(new Set(["fusion", "chaine"]));
    expect(await solvedPuzzles(server, id)).toEqual(new Set(["hache"]));
    const [{ points }] = await admin`select collection_points as points from yugioh.profiles where user_id = ${id}`;
    expect(points).toBe(2 * LESSON_POINTS);
  });
});
