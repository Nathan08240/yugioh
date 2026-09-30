import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { STANDARD_RULES } from "../src/duel.ts";
import { REPORT_LIMIT, replay, saveReport, type Report } from "../src/report.ts";
import { type Pg, startPostgres } from "./pg.ts";

const report: Report = {
  mode: "bot",
  room: "ABCDE",
  turn: 3,
  date: "2026-09-30T10:00:00.000Z",
  seed: ["1", "2", "3", "4"],
  rules: STANDARD_RULES,
  decks: [{ main: YUGI, extra: [] }, { main: KAIBA, extra: [] }],
  responses: [],
};

describe("signalements sur Postgres jetable", () => {
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

  it("limite à 5 signalements par joueur et par heure, sans gêner les autres joueurs", async () => {
    const [yugi, kaiba] = [await newPlayer("Yugi"), await newPlayer("Kaiba")];
    for (let i = 0; i < REPORT_LIMIT; i++) expect(await saveReport(server, yugi, `problème ${i}`, report)).toBe(true);
    expect(await saveReport(server, yugi, "de trop", report)).toBe(false);
    expect(await saveReport(server, kaiba, "", report)).toBe(true);
    await admin`update yugioh.bug_reports set created_at = now() - interval '2 hours' where user_id = ${yugi} and message = 'problème 0'`;
    expect(await saveReport(server, yugi, "une heure plus tard", report)).toBe(true);
    const [{ count }] = await admin<{ count: string }[]>`select count(*) from yugioh.bug_reports where user_id = ${yugi}`;
    expect(count).toBe("6");
  });

  it("relit le payload enregistré, et son rejeu donne deux fois les mêmes messages", { timeout: 30_000 }, async () => {
    const id = await newPlayer("Joey");
    await saveReport(server, id, "Trou Noir", report);
    const [row] = await server<{ message: string; payload: Report }[]>`select message, payload from yugioh.bug_reports where user_id = ${id}`;
    expect(row).toEqual({ message: "Trou Noir", payload: report });
    const first = await replay(row.payload);
    expect(first.length).toBeGreaterThan(0);
    expect(await replay(row.payload)).toEqual(first);
  });

  it("refuse un texte de plus de 500 caractères et un signalement trop volumineux, et ne laisse ni modifier ni supprimer", async () => {
    const id = await newPlayer("Tea");
    await expect(saveReport(server, id, "x".repeat(501), report)).rejects.toThrow();
    await expect(saveReport(server, id, "", { ...report, responses: Array(200_000).fill({ type: 1, index: 0 }) })).rejects.toThrow();
    await saveReport(server, id, "x".repeat(500), report);
    await expect(server`update yugioh.bug_reports set message = '' where user_id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(server`delete from yugioh.bug_reports where user_id = ${id}`).rejects.toThrow(/permission denied/);
  });
});
