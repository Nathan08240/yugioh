import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminReports, clientErrors, ERRORS_KEPT, markReport, readReport, saveClientError } from "../src/admin.ts";
import { createProfile, type Db } from "../src/db.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { STANDARD_RULES } from "../src/duel.ts";
import type { ClientError } from "../src/protocol.ts";
import { saveReport, type Report } from "../src/report.ts";
import { type Pg, startPostgres } from "./pg.ts";

const report: Report = {
  mode: "online",
  room: "ABCDE",
  turn: 4,
  date: "2026-10-08T10:00:00.000Z",
  seed: ["1", "2", "3", "4"],
  rules: STANDARD_RULES,
  decks: [{ main: YUGI, extra: [] }, { main: KAIBA, extra: [] }],
  responses: [],
};
const error: ClientError = { kind: "error", message: "x is undefined", stack: "TypeError\n    at f (app.js:1:2)", page: "accueil", build: "B1", browser: "Edge" };

describe("administration sur Postgres jetable", () => {
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

  it("liste les signalements non traités d'abord, avec joueur, mode et tour, et les marque traités ou non", async () => {
    const [yugi, kaiba] = [await newPlayer("Yugi"), await newPlayer("Kaiba")];
    await saveReport(server, yugi, "premier", report);
    await saveReport(server, kaiba, "deuxième", { ...report, mode: "puzzle", turn: 2 });
    await saveReport(server, yugi, "troisième", report);
    const [first, second, third] = [...(await adminReports(server))].sort((a, b) => a.id - b.id);
    expect(third).toMatchObject({ pseudo: "Yugi", mode: "online", turn: 4, message: "troisième", handled: false });
    expect(second).toMatchObject({ pseudo: "Kaiba", mode: "puzzle", turn: 2 });
    expect(Number.isNaN(Date.parse(first.date))).toBe(false);

    expect(await markReport(server, second.id, true)).toBe(true);
    expect((await adminReports(server)).map(({ id, handled }) => [id, handled])).toEqual([[third.id, false], [first.id, false], [second.id, true]]);
    expect(await markReport(server, second.id, false)).toBe(true);
    expect((await adminReports(server)).every(({ handled }) => !handled)).toBe(true);
    expect(await markReport(server, 999_999, true)).toBe(false);
  });

  it("relit le payload d'un signalement, sans laisser changer son texte ni le supprimer", async () => {
    const [{ id }] = await adminReports(server);
    expect(await readReport(server, id)).toEqual(expect.objectContaining({ room: "ABCDE", seed: ["1", "2", "3", "4"] }));
    expect(await readReport(server, 999_999)).toBeUndefined();
    await expect(server`update yugioh.bug_reports set message = '' where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(server`delete from yugioh.bug_reports where id = ${id}`).rejects.toThrow(/permission denied/);
  });

  it("regroupe les erreurs identiques avec un compteur, le dernier joueur touché, et les plus fréquentes d'abord", async () => {
    const [joey, tea] = [await newPlayer("Joey"), await newPlayer("Tea")];
    await saveClientError(server, joey, error);
    await saveClientError(server, joey, { kind: "rejection", message: "rare" });
    await saveClientError(server, joey, error);
    await saveClientError(server, tea, { ...error, stack: `${error.stack}\n    at g (app.js:3:4)`, page: "profil", build: "B2", browser: "Firefox" });
    const list = await clientErrors(server);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: "error", message: "x is undefined", count: 3, pseudo: "Tea", page: "profil", build: "B2", browser: "Firefox" });
    expect(list[1]).toMatchObject({ kind: "rejection", message: "rare", stack: "", count: 1, pseudo: "Joey" });
    expect(Date.parse(list[0].firstSeen)).toBeLessThanOrEqual(Date.parse(list[0].lastSeen));
  });

  it("coupe les champs trop longs, et ne garde que les ERRORS_KEPT erreurs vues le plus récemment", { timeout: 60_000 }, async () => {
    const id = await newPlayer("Mai");
    await saveClientError(server, id, { kind: "render", message: "m".repeat(2000), stack: "s".repeat(9000), page: "p".repeat(900), build: "b".repeat(900), browser: "u".repeat(9000) });
    const [row] = (await clientErrors(server)).filter(({ kind }) => kind === "render");
    expect([row.message.length, row.stack.length, row.page.length, row.build.length, row.browser.length]).toEqual([300, 2000, 100, 40, 200]);

    await admin`truncate yugioh.client_errors`;
    await admin`insert into yugioh.client_errors (fingerprint, kind, message, last_seen_at) select md5(n::text) || md5(n::text), 'error', 'anciennes ' || n, now() - interval '1 day' from generate_series(1, ${ERRORS_KEPT}) n`;
    await saveClientError(server, id, { kind: "error", message: "nouvelle" });
    const [{ count }] = await admin<{ count: string }[]>`select count(*) from yugioh.client_errors`;
    expect(count).toBe(String(ERRORS_KEPT));
    expect((await admin`select 1 from yugioh.client_errors where message = 'nouvelle'`).length).toBe(1);
  });

  it("garde l'erreur quand le joueur est supprimé, sans compte associé", async () => {
    const id = await newPlayer("Bakura");
    await saveClientError(server, id, { kind: "error", message: "orpheline" });
    await admin`delete from auth.users where id = ${id}`;
    expect((await clientErrors(server)).find(({ message }) => message === "orpheline")).toMatchObject({ pseudo: null, count: 1 });
  });
});
