import type postgres from "postgres";
import { OcgMessageType, OcgProcessResult, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { Db } from "./db.ts";
import { openDuel, type Placed, type Rules } from "./duel.ts";
import type { BotLevel } from "./protocol.ts";
import { engineForm } from "./respond.ts";

// Per player and per hour.
export const REPORT_LIMIT = 5;
// Size of the JSON of a report, and of one recorded response.
export const REPORT_BYTES = 512 * 1024;
export const RESPONSE_BYTES = 4096;
const MAX_STEPS = 20_000;

// Everything needed to replay a duel: the engine seed (bigints as strings), the rules, both decks and every response the engine accepted.
export type Report = {
  mode: "online" | "bot" | "histoire" | "puzzle";
  room: string;
  turn: number;
  date: string;
  level?: BotLevel;
  seed: string[];
  rules: Rules;
  decks: { main: number[]; extra: number[] }[];
  // The cards placed before the start, for a puzzle.
  field?: Placed[];
  responses: OcgResponse[];
};

// Stores the report unless the player already sent REPORT_LIMIT of them in the last hour. Resolves to whether it was stored.
export async function saveReport(db: Db, userId: string, message: string, report: Report): Promise<boolean> {
  const rows = await db`
    insert into yugioh.bug_reports (user_id, message, payload)
    select ${userId}::uuid, ${message}::text, ${db.json(report as unknown as postgres.JSONValue)}
    where (select count(*) from yugioh.bug_reports where user_id = ${userId}::uuid and created_at > now() - interval '1 hour') < ${REPORT_LIMIT}
    returning id`;
  return rows.length > 0;
}

// Runs the duel of a report again, answering each question with the next recorded response, and returns every message of the engine.
export async function replay(report: Report, trace: { messages?: (messages: OcgMessage[]) => void; answer?: (response: OcgResponse) => void } = {}): Promise<OcgMessage[]> {
  const seed = report.seed.map(BigInt) as [bigint, bigint, bigint, bigint];
  const { lib, handle } = await openDuel(seed, report.decks.map((deck) => deck.main), console.error, undefined, report.rules, report.decks.map((deck) => deck.extra), report.field);
  const out: OcgMessage[] = [];
  try {
    let next = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const status = lib.duelProcess(handle);
      const messages = lib.duelGetMessage(handle);
      out.push(...messages);
      trace.messages?.(messages);
      if (status === OcgProcessResult.END || messages.some((msg) => msg.type === OcgMessageType.WIN)) break;
      const question = messages.at(-1);
      if (status !== OcgProcessResult.WAITING || !question || !("player" in question)) continue;
      const response = report.responses[next++];
      if (!response) break;
      trace.answer?.(response);
      lib.duelSetResponse(handle, engineForm(response));
    }
  } finally {
    lib.destroyDuel(handle);
  }
  return out;
}
