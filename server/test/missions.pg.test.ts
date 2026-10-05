import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPoints } from "../src/collection.ts";
import { createProfile, type Db } from "../src/db.ts";
import { SLIFER_ANIME } from "../src/decks.ts";
import { dailyMissions, missionsView, progressMissions, type Gains } from "../src/missions.ts";
import { type Pg, startPostgres } from "./pg.ts";

const DAY = "2026-10-02";
// Enough to reach any 3 missions of the day.
const ALL: Gains = { wins: 3, fusionWins: 1, summons: 5, damage: 3000, storyWins: 1, ranked: 1, boosters: 2 };

describe("missions et succès sur Postgres jetable", () => {
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

  const pending = async (userId: string) => (await admin<{ pending: number }[]>`select pending from yugioh.booster_state where user_id = ${userId}`)[0]?.pending ?? 0;
  const day = async (userId: string) => (await admin`select wins, summons, damage from yugioh.mission_days where user_id = ${userId} and day = ${DAY}`)[0];

  it("verse les 3 missions, le booster bonus et la première victoire une seule fois, même en parallèle", async () => {
    const id = await newPlayer("Missions");
    const points = dailyMissions(id, DAY).reduce((sum, mission) => sum + mission.points, 0);
    await Promise.all([progressMissions(server, id, { gains: ALL }, DAY), missionsView(server, id, DAY), missionsView(server, id, DAY)]);
    const view = await missionsView(server, id, DAY);

    expect(view.missions.every((mission) => mission.progress === mission.goal)).toBe(true);
    expect(view.achievements.find((achievement) => achievement.id === "premiere_victoire")).toMatchObject({ progress: 1 });
    expect(await readPoints(server, id)).toBe(points + 100);
    expect(await pending(id)).toBe(1);
    await progressMissions(server, id, { gains: ALL }, DAY);
    expect(await readPoints(server, id)).toBe(points + 100);
    expect(await pending(id)).toBe(1);
  });

  it("garde le meilleur duel pour les invocations et les dégâts, additionne les victoires", async () => {
    const id = await newPlayer("Meilleur");
    await progressMissions(server, id, { gains: { wins: 1, summons: 4, damage: 2500 } }, DAY);
    await progressMissions(server, id, { gains: { wins: 1, summons: 3, damage: 2800 } }, DAY);
    expect(await day(id)).toEqual({ wins: 2, summons: 4, damage: 2800 });
  });

  it("en ligne, ne compte qu'un duel par adversaire et par jour", async () => {
    const [id, rival, other] = [await newPlayer("Hote"), await newPlayer("Rival"), await newPlayer("Autre")];
    await progressMissions(server, id, { gains: { wins: 1 }, opponent: rival }, DAY);
    await progressMissions(server, id, { gains: { wins: 1 }, opponent: rival }, DAY);
    expect(await day(id)).toMatchObject({ wins: 1 });
    await progressMissions(server, id, { gains: { wins: 1 }, opponent: other }, DAY);
    await progressMissions(server, id, { gains: { wins: 1 }, opponent: rival }, "2026-10-03");
    expect(await day(id)).toMatchObject({ wins: 2 });
  });

  it("verse un succès de collection une seule fois", async () => {
    const id = await newPlayer("Divin");
    await admin`insert into yugioh.collection values (${id}, ${SLIFER_ANIME}, 1)`;
    const view = await missionsView(server, id, DAY);
    expect(view.achievements.find((achievement) => achievement.id === "dieu_egyptien")).toMatchObject({ progress: 1, goal: 1 });
    await missionsView(server, id, DAY);
    expect(await readPoints(server, id)).toBe(200);
  });
});
