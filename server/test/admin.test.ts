import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { cleanError, errorAllowed, ERRORS_PER_HOUR, fingerprint } from "../src/admin.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { STANDARD_RULES } from "../src/duel.ts";
import { ERROR_MAX, type AdminReport, type ClientError, type ClientMessage, type ServerMessage, type Wire } from "../src/protocol.ts";
import type { Report } from "../src/report.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

type Received = Wire<ServerMessage>;

const report: Report = {
  mode: "bot",
  room: "ABCDE",
  turn: 1,
  date: "2026-10-08T10:00:00.000Z",
  seed: ["1", "2", "3", "4"],
  rules: STANDARD_RULES,
  decks: [{ main: YUGI, extra: [] }, { main: KAIBA, extra: [] }],
  responses: [],
};
const listed: AdminReport = { id: 7, date: "2026-10-08T10:00:00.000Z", pseudo: "joueur", mode: "bot", turn: 1, message: "bug", handled: false };

const adminReports = vi.fn(async () => [listed]);
const clientErrors = vi.fn(async () => []);
const markReport = vi.fn(async (id: number) => id === 7);
const readReport = vi.fn(async (id: number) => (id === 7 ? report : undefined));
const saveClientError = vi.fn(async (_userId: string, _error: ClientError) => {});

process.env.ADMIN_USER_IDS = "admin";
const wss = startServer(0, fakeAccounts({ adminReports, clientErrors, markReport, readReport, saveClientError }), () => [1n, 2n, 3n, 4n], 0);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

async function player(user: string) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  socket.on("message", (data) => received.push(JSON.parse(String(data))));
  await once(socket, "open");
  const send = (msg: ClientMessage | object) => socket.send(JSON.stringify(msg));
  send({ type: "auth", token: user });
  await vi.waitFor(() => expect(received.some((msg) => msg.type === "profile")).toBe(true));
  const find = <T extends Received["type"]>(type: T) => received.findLast((msg): msg is Extract<Received, { type: T }> => msg.type === type);
  const errors = () => received.filter((msg) => msg.type === "error").map((msg) => msg.error);
  return { send, received, find, errors };
}

const ADMIN_MESSAGES: ClientMessage[] = [
  { type: "admin_reports" },
  { type: "admin_errors" },
  { type: "admin_report_handled", id: 7, handled: true },
  { type: "admin_report_replay", id: 7, seat: 0 },
];

describe("pages d'administration", () => {
  it("refuse toute lecture et toute action à un compte qui n'est pas admin, sans toucher aux données", async () => {
    vi.clearAllMocks();
    const joueur = await player("joueur");
    for (const msg of ADMIN_MESSAGES) joueur.send(msg);
    await vi.waitFor(() => expect(joueur.errors()).toHaveLength(ADMIN_MESSAGES.length));
    expect(new Set(joueur.errors())).toEqual(new Set(["commande réservée"]));
    expect(joueur.received.some((msg) => msg.type === "admin_reports" || msg.type === "admin_errors" || msg.type === "replay")).toBe(false);
    for (const spy of [adminReports, clientErrors, markReport, readReport]) expect(spy).not.toHaveBeenCalled();
  });

  it("donne les listes à un admin, qui marque un signalement traité et reçoit la liste à jour", async () => {
    vi.clearAllMocks();
    const admin = await player("admin");
    admin.send({ type: "admin_reports" });
    admin.send({ type: "admin_errors" });
    await vi.waitFor(() => expect(admin.find("admin_errors")).toEqual({ type: "admin_errors", errors: [] }));
    expect(admin.find("admin_reports")).toEqual({ type: "admin_reports", reports: [listed] });
    admin.send({ type: "admin_report_handled", id: 7, handled: true });
    admin.send({ type: "admin_report_handled", id: 8, handled: true });
    await vi.waitFor(() => expect(admin.errors()).toEqual(["signalement introuvable"]));
    expect(markReport.mock.calls).toEqual([[7, true], [8, true]]);
  });

  it("rejoue un signalement des deux côtés, sans fin inventée, et refuse un signalement inconnu ou un côté invalide", { timeout: 30_000 }, async () => {
    const admin = await player("admin");
    admin.send({ type: "admin_report_replay", id: 7, seat: 0 });
    await vi.waitFor(() => expect(admin.find("replay")).toBeDefined(), { timeout: 20_000 });
    const first = admin.find("replay");
    expect(first).toMatchObject({ id: 7, seat: 0, self: "Siège 1", opponent: "Siège 2" });
    expect(first?.batches.length).toBeGreaterThan(0);
    admin.send({ type: "admin_report_replay", id: 7, seat: 1 });
    await vi.waitFor(() => expect(admin.received.filter((msg) => msg.type === "replay")).toHaveLength(2), { timeout: 20_000 });
    const second = admin.find("replay");
    expect(second).toMatchObject({ seat: 1, self: "Siège 2", opponent: "Siège 1" });
    expect(second?.batches).not.toEqual(first?.batches);
    // Not a finished duel: no WIN of the engine is added.
    expect(first?.batches.flat().some((msg) => msg.type === OcgMessageType.WIN)).toBe(false);
    admin.send({ type: "admin_report_replay", id: 99, seat: 0 });
    admin.send({ type: "admin_report_replay", id: 7, seat: 2 });
    await vi.waitFor(() => expect(admin.errors()).toEqual(["signalement introuvable", "message invalide"]));
  });
});

describe("erreurs du navigateur", () => {
  const error: ClientError = { kind: "error", message: "x is undefined", stack: "TypeError\n    at f (app.js:1:2)", page: "accueil", build: "2026-10-08 11:00", browser: "Edge" };

  it("garde au plus ERRORS_PER_HOUR erreurs par joueur, sans rien répondre ni gêner un autre joueur", async () => {
    saveClientError.mockClear();
    const [yugi, kaiba] = [await player("yugi"), await player("kaiba")];
    for (let i = 0; i < ERRORS_PER_HOUR + 3; i++) yugi.send({ type: "client_error", ...error, message: `erreur ${i}` });
    kaiba.send({ type: "client_error", ...error });
    await vi.waitFor(() => expect(saveClientError).toHaveBeenCalledTimes(ERRORS_PER_HOUR + 1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(saveClientError).toHaveBeenCalledTimes(ERRORS_PER_HOUR + 1);
    expect(saveClientError.mock.calls.filter(([id]) => id === "yugi")).toHaveLength(ERRORS_PER_HOUR);
    expect(saveClientError).toHaveBeenCalledWith("kaiba", expect.objectContaining({ message: "x is undefined" }));
    expect(yugi.errors()).toEqual([]);
    expect(kaiba.errors()).toEqual([]);
  });

  it("refuse une erreur mal formée", async () => {
    saveClientError.mockClear();
    const joey = await player("joey");
    joey.send({ type: "client_error", kind: "autre", message: "x" });
    joey.send({ type: "client_error", kind: "error" });
    joey.send({ type: "client_error", kind: "error", message: "x", stack: 3 });
    await vi.waitFor(() => expect(joey.errors()).toHaveLength(3));
    expect(saveClientError).not.toHaveBeenCalled();
  });

  it("compte à l'heure près, coupe chaque champ à sa limite et ne confond que les erreurs identiques", () => {
    const sent = new Map<string, number[]>();
    const start = 1_000_000;
    for (let i = 0; i < ERRORS_PER_HOUR; i++) expect(errorAllowed(sent, "a", start + i)).toBe(true);
    expect(errorAllowed(sent, "a", start + 1000)).toBe(false);
    expect(errorAllowed(sent, "b", start + 1000)).toBe(true);
    expect(errorAllowed(sent, "a", start + 3_600_000)).toBe(true);

    const long = cleanError({ kind: "render", message: "m".repeat(1000), stack: "s".repeat(10_000), page: "p".repeat(500), build: "b".repeat(500), browser: "u".repeat(5000) });
    expect(long).toEqual({ kind: "render", message: "m".repeat(ERROR_MAX.message), stack: "s".repeat(ERROR_MAX.stack), page: "p".repeat(ERROR_MAX.page), build: "b".repeat(ERROR_MAX.build), browser: "u".repeat(ERROR_MAX.browser) });
    expect(cleanError({ kind: "error", message: "m" })).toMatchObject({ stack: "", page: "", build: "", browser: "" });

    const same = fingerprint(cleanError(error));
    expect(fingerprint(cleanError({ ...error, page: "profil", build: "autre", browser: "Firefox" }))).toBe(same);
    expect(fingerprint(cleanError({ ...error, stack: `${error.stack}\n    at g (app.js:3:4)` }))).toBe(same);
    expect(fingerprint(cleanError({ ...error, message: "y is undefined" }))).not.toBe(same);
    expect(fingerprint(cleanError({ ...error, kind: "rejection" }))).not.toBe(same);
    expect(fingerprint(cleanError({ ...error, stack: "TypeError\n    at h (app.js:9:9)" }))).not.toBe(same);
  });
});
