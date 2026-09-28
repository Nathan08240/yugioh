import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OcgCardData } from "@n1xx1/ocgcore-wasm";

const vendor = join(import.meta.dirname, "..", "vendor");
if (!existsSync(vendor)) throw new Error("server/vendor absent : lancer `pnpm vendor`");

type Row = Record<"id" | "alias" | "setcode" | "type" | "atk" | "def" | "level" | "race" | "attribute", bigint> & { name: string };

const queries = ["cards.cdb", "cards-unofficial.cdb"].map((file) => {
  const db = new DatabaseSync(join(vendor, "BabelCDB", file), { readOnly: true });
  const query = db.prepare("SELECT d.*, t.name FROM datas d JOIN texts t ON t.id = d.id WHERE d.id = ?");
  query.setReadBigInts(true);
  return query;
});

function findRow(code: number): Row | undefined {
  for (const query of queries) {
    const row = query.get(code);
    if (row) return row as Row;
  }
  return undefined;
}

// ponytail: no pendulum scales or link markers, classic cards only.
export function readCard(code: number): OcgCardData | null {
  const row = findRow(code);
  if (!row) return null;
  return {
    code,
    alias: Number(row.alias),
    setcodes: [0n, 16n, 32n, 48n].map((shift) => Number((row.setcode >> shift) & 0xffffn)).filter(Boolean),
    type: Number(row.type),
    level: Number(row.level),
    attribute: Number(row.attribute),
    race: row.race,
    attack: Number(row.atk),
    defense: Number(row.def),
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  };
}

export function cardName(code: number): string {
  return findRow(code)?.name ?? `#${code}`;
}

const scriptDirs = ["", "official", "unofficial"].map((dir) => join(vendor, "CardScripts", dir));

export function readScript(name: string): string | null {
  const file = name.split("/").at(-1) ?? name;
  const dir = scriptDirs.find((d) => existsSync(join(d, file)));
  return dir === undefined ? null : readFileSync(join(dir, file), "utf-8");
}
