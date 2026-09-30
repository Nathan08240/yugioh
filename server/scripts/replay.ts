// Replays a bug report (the JSON stored in yugioh.bug_reports.payload) and prints the engine messages in order.
import { readFileSync } from "node:fs";
import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { replay, type Report } from "../src/report.ts";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage : pnpm --filter server replay <fichier.json>");
  process.exit(1);
}
const json = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? String(v) : v));
const report: Report = JSON.parse(readFileSync(file, "utf8"));
console.log(`# ${report.mode}, salle ${report.room}, tour ${report.turn}, ${report.date}, ${report.responses.length} réponses`);
await replay(report, {
  messages: (messages) => messages.forEach((msg) => console.log(`${OcgMessageType[msg.type]} ${json(msg)}`)),
  answer: (response) => console.log(`> réponse ${json(response)}`),
});
