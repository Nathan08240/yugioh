import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { loseTower, startTower, towerView, winTower } from "../src/tower.ts";
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
    expect(await startTower(server, id)).toBe(5);
    await loseTower(server, id, 5);
    expect(await progress(id)).toEqual({ floor: 0, best: 4, claimed: [3] });
    expect(await climb(id, 3)).toEqual([0, 0, 0]);
    expect(await progress(id)).toEqual({ floor: 3, best: 4, claimed: [3] });
    expect(await pending(id)).toBe(1);
  });

  it("garde l'étage après un duel interrompu, et ignore la défaite d'un étage déjà passé", async () => {
    const id = await newPlayer("Tour6");
    await climb(id, 4);
    // Started and left without result, twice: still floor 5.
    expect(await startTower(server, id)).toBe(5);
    expect(await startTower(server, id)).toBe(5);
    expect(await progress(id)).toEqual({ floor: 4, best: 4, claimed: [3] });
    // The loss of floor 3 comes from a room opened before floor 4 was cleared.
    await loseTower(server, id, 3);
    expect(await progress(id)).toEqual({ floor: 4, best: 4, claimed: [3] });
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

  it("rend les paliers gagnables à chaque semaine, record gardé", async () => {
    const id = await newPlayer("Tour5");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-07T12:00:00Z") });
    try {
      expect(await climb(id, 3)).toEqual([0, 0, 1]);
      // Sunday evening: still the same week.
      vi.setSystemTime(new Date("2026-10-11T20:00:00Z"));
      expect((await towerView(server, id)).claimed).toEqual([3]);
      // A lost duel sends back to floor 1.
      await loseTower(server, id, await startTower(server, id));
      expect(await climb(id, 3)).toEqual([0, 0, 0]);
      // Monday: the week turns over.
      vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
      expect(await progress(id)).toMatchObject({ best: 3, claimed: [] });
      await loseTower(server, id, await startTower(server, id));
      expect(await climb(id, 3)).toEqual([0, 0, 1]);
      expect(await pending(id)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
