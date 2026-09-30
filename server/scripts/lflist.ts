// Build data/goat-2005-04.json from YGOJSON: the TCG limits in force on 2005-04-01, for the cards of the pool.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowed } from "../src/pool.ts";

export const GOAT_DATE = "2005-04-01";
type Entry = { legality: string; date: string };
export type LimitCard = { passwords?: string[]; legality?: { tcg?: { history?: Entry[] } } };
const MAX = new Map([["forbidden", 0], ["limited", 1], ["semilimited", 2]]);

// The last TCG entry dated `date` or before gives the limit of each pooled passcode of a card; an unlimited card has no entry.
export function goatLimits(cards: Iterable<LimitCard>, inPool: (code: number) => boolean, date = GOAT_DATE): Record<number, number> {
  const limits: Record<number, number> = {};
  for (const { passwords = [], legality } of cards) {
    const last = legality?.tcg?.history?.filter((entry) => entry.date <= date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const max = MAX.get(last?.legality ?? "");
    if (max === undefined) continue;
    for (const code of passwords.map(Number).filter(inPool)) limits[code] = max;
  }
  return limits;
}

if (import.meta.main) {
  const dir = join(import.meta.dirname, "..", "vendor", "YGOJSON", "cards");
  if (!existsSync(dir)) throw new Error("server/vendor/YGOJSON absent : lancer `pnpm vendor`");
  const cards = readdirSync(dir).map((file): LimitCard => JSON.parse(readFileSync(join(dir, file), "utf-8")));
  const limits = goatLimits(cards, isAllowed);
  const entries = Object.entries(limits).sort(([a], [b]) => Number(a) - Number(b));
  const out = join(import.meta.dirname, "..", "data", "goat-2005-04.json");
  writeFileSync(out, JSON.stringify(Object.fromEntries(entries), null, 1) + "\n");
  console.log(`${entries.length} cartes limitées écrites dans ${out}`);
}
