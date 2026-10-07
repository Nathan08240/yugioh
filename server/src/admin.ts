import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { ERROR_KINDS, ERROR_MAX, type AdminError, type AdminReport, type ClientError, type ClientMessage } from "./protocol.ts";
import type { Report } from "./report.ts";

// Browser errors per player and per hour, and the grouped errors kept (the least recently seen are deleted first).
export const ERRORS_PER_HOUR = 10;
export const ERRORS_KEPT = 500;
const REPORTS_SHOWN = 100;
const ERRORS_SHOWN = 200;

// Bug reports and browser errors for the admin pages, faked in tests.
export type AdminStore = {
  adminReports: () => Promise<AdminReport[]>;
  readReport: (id: number) => Promise<Report | undefined>;
  // Resolves to false when there is no such report.
  markReport: (id: number, handled: boolean) => Promise<boolean>;
  saveClientError: (userId: string, error: ClientError) => Promise<void>;
  clientErrors: () => Promise<AdminError[]>;
};

export type AdminMessage = Extract<ClientMessage, { type: "admin_reports" | "admin_errors" | "admin_report_handled" | "admin_report_replay" }>;

const ADMIN_TYPES = new Set<ClientMessage["type"]>(["admin_reports", "admin_errors", "admin_report_handled", "admin_report_replay"]);

export const isAdminMessage = (msg: ClientMessage): msg is AdminMessage => ADMIN_TYPES.has(msg.type);

const optionalText = (value: unknown) => value === undefined || typeof value === "string";

// Shape check of an incoming admin or error message, before its type is trusted.
export function validAdminMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case "admin_reports":
    case "admin_errors":
      return true;
    case "admin_report_handled":
      return Number.isSafeInteger(msg.id) && typeof msg.handled === "boolean";
    case "admin_report_replay":
      return Number.isSafeInteger(msg.id) && (msg.seat === 0 || msg.seat === 1);
    case "client_error":
      return ERROR_KINDS.includes(msg.kind as ClientError["kind"]) && typeof msg.message === "string" && optionalText(msg.stack) && optionalText(msg.page) && optionalText(msg.build) && optionalText(msg.browser);
    default:
      return false;
  }
}

// Counts an error sent by `userId` in `sent` (times by player), false when they already sent ERRORS_PER_HOUR this last hour.
export function errorAllowed(sent: Map<string, number[]>, userId: string, now = Date.now()): boolean {
  const recent = (sent.get(userId) ?? []).filter((at) => now - at < 3_600_000);
  const allowed = recent.length < ERRORS_PER_HOUR;
  if (allowed) recent.push(now);
  sent.set(userId, recent);
  return allowed;
}

// Every text cut to its limit, the optional ones made empty.
export function cleanError(error: ClientError): Required<ClientError> {
  return {
    kind: error.kind,
    message: error.message.slice(0, ERROR_MAX.message),
    stack: (error.stack ?? "").slice(0, ERROR_MAX.stack),
    page: (error.page ?? "").slice(0, ERROR_MAX.page),
    build: (error.build ?? "").slice(0, ERROR_MAX.build),
    browser: (error.browser ?? "").slice(0, ERROR_MAX.browser),
  };
}

// Same kind, message and first frame: the same error. The frame holds the file of the build, so a new build starts a new group.
export const fingerprint = ({ kind, message, stack }: Required<ClientError>) => createHash("sha256").update(`${kind}\0${message}\0${stack.split("\n", 2).join("\n")}`).digest("hex");

export async function adminReports(db: Db): Promise<AdminReport[]> {
  const rows = await db<(Omit<AdminReport, "id" | "date"> & { id: string; date: Date })[]>`
    select r.id, r.created_at as date, p.pseudo, r.payload->>'mode' as mode, (r.payload->>'turn')::int as turn, r.message, r.handled_at is not null as handled
    from yugioh.bug_reports r join yugioh.profiles p on p.user_id = r.user_id
    order by r.handled_at is not null, r.id desc limit ${REPORTS_SHOWN}`;
  return rows.map((row) => ({ ...row, id: Number(row.id), date: row.date.toISOString() }));
}

export async function readReport(db: Db, id: number): Promise<Report | undefined> {
  const [row] = await db<{ payload: Report }[]>`select payload from yugioh.bug_reports where id = ${id}`;
  return row?.payload;
}

export async function markReport(db: Db, id: number, handled: boolean): Promise<boolean> {
  const rows = await db`update yugioh.bug_reports set handled_at = case when ${handled}::boolean then now() end where id = ${id} returning id`;
  return rows.length > 0;
}

// A repeated error adds 1 to its group, which then names the last player and build hit.
export async function saveClientError(db: Db, userId: string, error: ClientError): Promise<void> {
  const clean = cleanError(error);
  await db.begin(async (sql) => {
    await sql`
      insert into yugioh.client_errors (fingerprint, kind, message, stack, page, build, browser, user_id)
      values (${fingerprint(clean)}, ${clean.kind}, ${clean.message}, ${clean.stack}, ${clean.page}, ${clean.build}, ${clean.browser}, ${userId})
      on conflict (fingerprint) do update set count = client_errors.count + 1, last_seen_at = now(), user_id = excluded.user_id, page = excluded.page, build = excluded.build, browser = excluded.browser`;
    await sql`
      delete from yugioh.client_errors
      where id not in (select id from yugioh.client_errors order by last_seen_at desc, id desc limit ${ERRORS_KEPT})`;
  });
}

export async function clientErrors(db: Db): Promise<AdminError[]> {
  const rows = await db<(Omit<AdminError, "id" | "firstSeen" | "lastSeen"> & { id: string; firstSeen: Date; lastSeen: Date })[]>`
    select e.id, e.kind, e.message, e.stack, e.page, e.build, e.browser, p.pseudo, e.count, e.first_seen_at as "firstSeen", e.last_seen_at as "lastSeen"
    from yugioh.client_errors e left join yugioh.profiles p on p.user_id = e.user_id
    order by e.count desc, e.last_seen_at desc limit ${ERRORS_SHOWN}`;
  return rows.map((row) => ({ ...row, id: Number(row.id), firstSeen: row.firstSeen.toISOString(), lastSeen: row.lastSeen.toISOString() }));
}

export const dbAdminStore = (db: Db): AdminStore => ({
  adminReports: () => adminReports(db),
  readReport: (id) => readReport(db, id),
  markReport: (id, handled) => markReport(db, id, handled),
  saveClientError: (userId, error) => saveClientError(db, userId, error),
  clientErrors: () => clientErrors(db),
});
