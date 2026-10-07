import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { onlineToday, winOnline } from "../src/online.ts";
import { ONLINE_BOOSTERS_MAX } from "../src/protocol.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("boosters des victoires en ligne sur Postgres jetable", () => {
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

  it("plafonne les boosters à ONLINE_BOOSTERS_MAX par jour, le lendemain rouvre le droit", async () => {
    const id = await newPlayer("Online1");
    const other = await newPlayer("Online2");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-07T12:00:00Z") });
    try {
      for (let i = 0; i < ONLINE_BOOSTERS_MAX; i++) expect(await winOnline(server, id)).toBe(true);
      expect(await winOnline(server, id)).toBe(false);
      expect(await onlineToday(server, id)).toBe(ONLINE_BOOSTERS_MAX);
      expect(await pending(id)).toBe(ONLINE_BOOSTERS_MAX);
      expect(await onlineToday(server, other)).toBe(0);
      // Past midnight in Paris.
      vi.setSystemTime(new Date("2026-10-07T22:30:00Z"));
      expect(await onlineToday(server, id)).toBe(0);
      expect(await winOnline(server, id)).toBe(true);
      expect(await pending(id)).toBe(ONLINE_BOOSTERS_MAX + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ne dépasse pas le plafond quand plusieurs duels se terminent en même temps", async () => {
    const id = await newPlayer("Online3");
    const results = await Promise.all(Array.from({ length: 12 }, () => winOnline(server, id)));
    expect(results.filter(Boolean)).toHaveLength(ONLINE_BOOSTERS_MAX);
    expect(await pending(id)).toBe(ONLINE_BOOSTERS_MAX);
    expect(await onlineToday(server, id)).toBe(ONLINE_BOOSTERS_MAX);
  });
});
