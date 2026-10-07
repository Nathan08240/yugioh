import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { STANDARD_RULES } from "../src/duel.ts";
import { HISTORY_MAX, listReplays, readReplay, replayBatches, saveReplay, type HistoryEntry } from "../src/history.ts";
import { type Pg, startPostgres } from "./pg.ts";

const replay: HistoryEntry["replay"] = {
  mode: "bot",
  room: "ABCDE",
  turn: 0,
  date: "2026-10-02T12:00:00.000Z",
  seed: ["1", "2", "3", "4"],
  rules: STANDARD_RULES,
  decks: [{ main: YUGI, extra: [] }, { main: KAIBA, extra: [] }],
  responses: [],
  end: { winner: 1, reason: 0 },
};

describe("duels à revoir sur Postgres jetable", () => {
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

  const entry = (userId: string, opponent: string): HistoryEntry => ({ userId, seat: 0, mode: "bot", opponent, won: false, replay });

  it(`garde les ${HISTORY_MAX} derniers duels de chaque joueur, les plus récents d'abord`, async () => {
    const [yugi, kaiba] = [await newPlayer("Yugi"), await newPlayer("Kaiba")];
    await saveReplay(server, entry(kaiba, "Bot"));
    for (let i = 1; i <= HISTORY_MAX + 1; i++) await saveReplay(server, entry(yugi, `Bot ${i}`));
    const list = await listReplays(server, yugi);
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0]).toMatchObject({ mode: "bot", opponent: `Bot ${HISTORY_MAX + 1}`, won: false });
    expect(list.at(-1)?.opponent).toBe("Bot 2");
    expect(Number.isNaN(Date.parse(list[0].date))).toBe(false);
    const [{ count }] = await admin<{ count: string }[]>`select count(*) from yugioh.duel_replays where user_id = ${yugi}`;
    expect(count).toBe(String(HISTORY_MAX));
    expect(await listReplays(server, kaiba)).toHaveLength(1);
  });

  it("relit un duel de ce joueur seulement, et son rejeu finit par la fin enregistrée", { timeout: 30_000 }, async () => {
    const [joey, tea] = [await newPlayer("Joey"), await newPlayer("Tea")];
    await saveReplay(server, entry(joey, "Bot"));
    const [{ id }] = await listReplays(server, joey);
    const stored = await readReplay(server, joey, id);
    expect(stored).toEqual({ seat: 0, opponent: "Bot", replay });
    expect(await readReplay(server, tea, id)).toBeUndefined();
    const { batches } = await replayBatches(replay, 0);
    expect(batches.at(-1)?.[0]).toEqual({ type: OcgMessageType.WIN, player: 1, reason: 0 });
  });

  it("refuse un mode inconnu et un duel trop volumineux", async () => {
    const id = await newPlayer("Mai");
    await expect(saveReplay(server, { ...entry(id, "Bot"), mode: "autre" as HistoryEntry["mode"] })).rejects.toThrow();
    await expect(saveReplay(server, { ...entry(id, "Bot"), replay: { ...replay, responses: Array(200_000).fill({ type: 1, index: 0 }) } })).rejects.toThrow();
  });
});
