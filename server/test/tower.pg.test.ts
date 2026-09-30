import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { startTower, towerView, winTower } from "../src/tower.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("mode Tour sur Postgres jetable", () => {
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

  const pending = async (userId: string) => (await admin`select pending from yugioh.booster_state where user_id = ${userId}`)[0]?.pending ?? 0;
  const progress = async (userId: string) => {
    const { floor, best, claimed } = await towerView(server, userId);
    return { floor, best, claimed };
  };

  // Wins `count` floors in a row, from the floor startTower gives; resolves to the boosters of each win.
  async function climb(userId: string, count: number): Promise<number[]> {
    const boosters = [];
    for (let i = 0; i < count; i++) boosters.push((await winTower(server, userId, await startTower(server, userId))).boosters);
    return boosters;
  }

  it("monte d'un étage par victoire et paie le palier de l'étage 3", async () => {
    const id = await newPlayer("Tour1");
    expect(await progress(id)).toEqual({ floor: 0, best: 0, claimed: [] });
    expect((await towerView(server, id)).floors).toHaveLength(10);
    expect(await climb(id, 3)).toEqual([0, 0, 1]);
    expect(await progress(id)).toEqual({ floor: 3, best: 3, claimed: [3] });
    expect(await startTower(server, id)).toBe(4);
  });

  it("renvoie à l'étage 1 après une défaite, garde le record et ne paie un palier qu'une fois", async () => {
    const id = await newPlayer("Tour2");
    await climb(id, 4);
    // Floor 5 started and lost: nothing records it.
    expect(await startTower(server, id)).toBe(5);
    expect(await progress(id)).toEqual({ floor: 0, best: 4, claimed: [3] });
    expect(await climb(id, 3)).toEqual([0, 0, 0]);
    expect(await progress(id)).toEqual({ floor: 3, best: 4, claimed: [3] });
    expect(await pending(id)).toBe(1);
  });

  it("paie 1, 2 et 3 boosters aux étages 3, 6 et 10, puis recommence la Tour", async () => {
    const id = await newPlayer("Tour3");
    expect(await climb(id, 10)).toEqual([0, 0, 1, 0, 0, 2, 0, 0, 0, 3]);
    expect(await progress(id)).toEqual({ floor: 0, best: 10, claimed: [3, 6, 10] });
    expect(await pending(id)).toBe(6);
    expect(await climb(id, 10)).toEqual(Array.from({ length: 10 }, () => 0));
    expect(await pending(id)).toBe(6);
  });

  it("ne paie qu'une fois des victoires simultanées d'un palier", async () => {
    const id = await newPlayer("Tour4");
    const wins = await Promise.all(Array.from({ length: 5 }, () => winTower(server, id, 3)));
    expect(wins.map((win) => win.boosters).sort((a, b) => a - b)).toEqual([0, 0, 0, 0, 1]);
    expect(await pending(id)).toBe(1);
  });
});
