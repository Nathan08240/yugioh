import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { claimEvent, eventWon } from "../src/event.ts";
import { EVENT_BOOSTERS } from "../src/protocol.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("booster de l'événement sur Postgres jetable", () => {
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

  it("crédite 2 boosters par semaine et par joueur, la semaine suivante rouvre le droit", async () => {
    const id = await newPlayer("Kaiba");
    const other = await newPlayer("Joey");
    expect(await eventWon(server, id, "2026-W40")).toBe(false);
    expect(await claimEvent(server, id, "2026-W40")).toBe(true);
    expect(await claimEvent(server, id, "2026-W40")).toBe(false);
    expect(await eventWon(server, id, "2026-W40")).toBe(true);
    expect(await pending(id)).toBe(EVENT_BOOSTERS);
    expect(await eventWon(server, other, "2026-W40")).toBe(false);
    expect(await claimEvent(server, id, "2026-W41")).toBe(true);
    expect(await pending(id)).toBe(2 * EVENT_BOOSTERS);
    expect(await pending(other)).toBe(0);
  });
});
