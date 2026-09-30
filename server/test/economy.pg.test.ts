import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditBoosters, hasUltra, openBooster, ULTRA_PITY } from "../src/boosters.ts";
import { readCollection, readPoints, readRarities } from "../src/collection.ts";
import { claimDaily, convertDuplicates, craftCard, CRAFT_COSTS, previewConversion } from "../src/economy.ts";
import { createProfile, type Db } from "../src/db.ts";
import { REPLAY_BOOSTERS_MAX, REPLAY_WINS } from "../src/protocol.ts";
import { completeDuel, STORY_DUELS, type StoryDuel } from "../src/story.ts";
import { type Pg, startPostgres } from "./pg.ts";

const BLUE_EYES = 89631139;
const COMMON = [...CRAFT_COSTS].find(([, cost]) => cost === 40)?.[0] as number;

describe("économie sur Postgres jetable", () => {
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

  // Cards as [passcode, quantity], and their copies of known rarity.
  async function give(userId: string, cards: [number, number][], rarities: [number, string, number][]) {
    for (const [code, quantity] of cards) await admin`insert into yugioh.collection values (${userId}, ${code}, ${quantity})`;
    for (const [code, rarity, quantity] of rarities) await admin`insert into yugioh.collection_rarities values (${userId}, ${code}, ${rarity}, ${quantity})`;
  }

  const pending = async (userId: string) => (await admin<{ pending: number }[]>`select pending from yugioh.booster_state where user_id = ${userId}`)[0]?.pending ?? 0;
  const exchanges = (userId: string) =>
    admin`select kind, card_code, rarity, quantity, points from yugioh.collection_exchanges where user_id = ${userId} order by id`;

  it("convertit exactement l'aperçu, garde 3 exemplaires et prend les raretés les plus faibles d'abord", async () => {
    const id = await newPlayer("Yugi");
    await give(id, [[1, 3], [2, 8], [3, 5]], [[1, "ultra", 3], [2, "secret", 1], [2, "rare", 2], [2, "common", 1], [3, "super", 3], [3, "ultra", 2]]);

    const preview = await previewConversion(server, id);
    expect(preview).toEqual({ cards: [[2, "", 4], [2, "common", 1], [3, "super", 2]], points: 4 * 5 + 5 + 2 * 50 });
    expect(await convertDuplicates(server, id, preview.points - 1)).toBe("la collection a changé, relancez l'aperçu");
    expect(await convertDuplicates(server, id, preview.points)).toBeUndefined();

    expect(await readCollection(server, id)).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(await readRarities(server, id)).toEqual([[1, "ultra", 3], [2, "rare", 2], [2, "secret", 1], [3, "super", 1], [3, "ultra", 2]]);
    expect(await readPoints(server, id)).toBe(preview.points);
    expect(await exchanges(id)).toEqual([
      { kind: "convert", card_code: 2, rarity: null, quantity: 4, points: 20 },
      { kind: "convert", card_code: 2, rarity: "common", quantity: 1, points: 5 },
      { kind: "convert", card_code: 3, rarity: "super", quantity: 2, points: 100 },
    ]);
    expect(await previewConversion(server, id)).toEqual({ cards: [], points: 0 });
    expect(await convertDuplicates(server, id, 0)).toBe("aucun doublon à convertir");
  });

  it("n'accorde qu'une fois des conversions simultanées", async () => {
    const id = await newPlayer("Mai");
    await give(id, [[1, 13]], [[1, "rare", 10]]);
    const { points } = await previewConversion(server, id);
    await Promise.all(Array.from({ length: 10 }, () => server`select pg_sleep(0.2)`));
    const results = await Promise.all(Array.from({ length: 10 }, () => convertDuplicates(server, id, points)));
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(await readPoints(server, id)).toBe(3 * 5 + 7 * 20);
    expect(await readCollection(server, id)).toEqual([[1, 3]]);
  });

  it("obtient une carte en Commune contre son coût, jusqu'à 3 exemplaires, et refuse sans assez de points", async () => {
    const id = await newPlayer("Kaiba");
    expect(await craftCard(server, id, BLUE_EYES)).toBe("points insuffisants : 500 nécessaires");
    expect(await craftCard(server, id, 12345)).toBe("carte introuvable dans les boosters");
    await admin`update yugioh.profiles set collection_points = 1000 where user_id = ${id}`;
    await give(id, [[COMMON, 2]], []);

    expect(await craftCard(server, id, BLUE_EYES)).toBeUndefined();
    expect(await craftCard(server, id, COMMON)).toBeUndefined();
    expect(await craftCard(server, id, COMMON)).toBe("déjà 3 exemplaires de cette carte");
    expect(await readPoints(server, id)).toBe(1000 - 500 - 40);
    expect(new Map(await readCollection(server, id))).toEqual(new Map([[COMMON, 3], [BLUE_EYES, 1]]));
    expect((await readRarities(server, id)).map(([code, rarity, quantity]) => `${code} ${rarity} ${quantity}`).sort()).toEqual([`${BLUE_EYES} common 1`, `${COMMON} common 1`].sort());
    expect(await craftCard(server, id, BLUE_EYES)).toBe("points insuffisants : 500 nécessaires");
    expect(await exchanges(id)).toEqual([
      { kind: "craft", card_code: BLUE_EYES, rarity: "common", quantity: 1, points: -500 },
      { kind: "craft", card_code: COMMON, rarity: "common", quantity: 1, points: -40 },
    ]);
  });

  it("garantit une Ultra Rare après 20 boosters sans, et remet le compteur à zéro à chaque Ultra", { timeout: 30_000 }, async () => {
    const id = await newPlayer("Joey");
    const since = async () => (await admin<{ n: number }[]>`select since_ultra as n from yugioh.booster_state where user_id = ${id}`)[0].n;
    await creditBoosters(server, id, 61);
    // Tirages au hasard : chaque ouverture suit la règle, qu'elle donne une Ultra ou non.
    for (let i = 0; i < 40; i++) {
      const before = (await admin<{ n: number }[]>`select since_ultra as n from yugioh.booster_state where user_id = ${id}`)[0]?.n ?? 0;
      const pack = await openBooster(server, id, "LOB");
      if (before >= ULTRA_PITY) expect(hasUltra(pack)).toBe(true);
      expect(await since()).toBe(hasUltra(pack) ? 0 : before + 1);
    }
    for (let i = 0; i < 20; i++) {
      await admin`update yugioh.booster_state set since_ultra = ${ULTRA_PITY} where user_id = ${id}`;
      expect(hasUltra(await openBooster(server, id, "SOD"))).toBe(true);
      expect(await since()).toBe(0);
    }
  });

  it("n'accorde la récompense du jour qu'une fois par jour, même en parallèle", async () => {
    const id = await newPlayer("Tea");
    await Promise.all(Array.from({ length: 10 }, () => server`select pg_sleep(0.2)`));
    const results = await Promise.all(Array.from({ length: 10 }, () => claimDaily(server, id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await pending(id)).toBe(1);
    expect(await claimDaily(server, id)).toBe(false);

    await admin`update yugioh.profiles set daily_on = daily_on - 1 where user_id = ${id}`;
    expect(await claimDaily(server, id)).toBe(true);
    expect(await pending(id)).toBe(2);
  });

  it("plafonne les boosters de rejeu à 2 par jour, les victoires suivantes ne comptent plus", async () => {
    const id = await newPlayer("Tristan");
    const weevil = STORY_DUELS.get("dk-weevil") as StoryDuel;
    await completeDuel(server, id, weevil, 1);
    const firstWin = await pending(id);
    const replays = [];
    for (let i = 0; i < REPLAY_WINS * REPLAY_BOOSTERS_MAX + 2; i++) {
      const { replays: place, replayLimit } = await completeDuel(server, id, weevil, 1);
      replays.push(replayLimit ? "limite" : place);
    }
    expect(replays).toEqual([1, 2, 3, 1, 2, 3, "limite", "limite"]);
    expect(await pending(id)).toBe(firstWin + REPLAY_BOOSTERS_MAX);

    // Le lendemain, la série reprend là où elle s'était arrêtée.
    await admin`update yugioh.profiles set replay_on = replay_on - 1 where user_id = ${id}`;
    expect((await completeDuel(server, id, weevil, 1)).replays).toBe(1);
  });
});
