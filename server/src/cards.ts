import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OcgCardData } from "@n1xx1/ocgcore-wasm";
import type { CardInfo } from "./protocol.ts";
import { attributeName, typeLine } from "./strings.ts";

const vendor = join(import.meta.dirname, "..", "vendor");
if (!existsSync(vendor)) throw new Error("server/vendor absent : lancer `pnpm vendor`");

type Row = Record<"id" | "alias" | "setcode" | "type" | "atk" | "def" | "level" | "race" | "attribute", bigint> &
  Record<"name" | "desc" | `str${number}`, string | null>;

const queries = ["cards.cdb", "cards-unofficial.cdb"].map((file) => {
  const db = new DatabaseSync(join(vendor, "BabelCDB", file), { readOnly: true });
  const query = db.prepare("SELECT d.*, t.* FROM datas d JOIN texts t ON t.id = d.id WHERE d.id = ?");
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

// English, as in BabelCDB, without the labels and `image` of the client's CardInfo.
export function cardInfo(code: number): Omit<CardInfo, "image" | "attributeName" | "typeLine"> | undefined {
  const row = findRow(code);
  if (!row) return undefined;
  const strings = Array.from({ length: 16 }, (_, i) => row[`str${i + 1}`] ?? "");
  while (strings.at(-1) === "") strings.pop();
  return {
    name: row.name ?? `#${code}`,
    alias: Number(row.alias),
    desc: row.desc ?? "",
    type: Number(row.type),
    level: Number(row.level & 0xffn),
    attribute: Number(row.attribute),
    race: Number(row.race),
    atk: Number(row.atk),
    def: Number(row.def),
    strings,
  };
}

type French = { name: string; desc?: string };
let french: ReadonlyMap<number, French> | undefined;

// Written by `pnpm vendor` from YGOJSON.
function frenchText(code: number): French | undefined {
  if (!french) {
    const file = join(vendor, "cards-fr.json");
    if (!existsSync(file)) throw new Error("server/vendor/cards-fr.json absent : lancer `pnpm vendor`");
    const texts: Record<string, French> = JSON.parse(readFileSync(file, "utf-8"));
    french = new Map(Object.entries(texts).map(([passcode, text]) => [Number(passcode), text]));
  }
  return french.get(code);
}

// The card as the client shows it: French name and text, English from BabelCDB for a card YGOJSON does not translate
// (anime cards). Without `image`, which depends on the downloaded files.
export function clientCard(code: number): Omit<CardInfo, "image"> | undefined {
  const info = cardInfo(code);
  if (!info) return undefined;
  const text = frenchText(code);
  return {
    ...info,
    name: text?.name ?? info.name,
    desc: text?.desc ?? info.desc,
    attributeName: attributeName(info.attribute),
    typeLine: typeLine(info.type, info.race),
  };
}

const scriptDirs = ["", "official", "unofficial"].map((dir) => join(vendor, "CardScripts", dir));

export function readScript(name: string): string | null {
  const file = name.split("/").at(-1) ?? name;
  const dir = scriptDirs.find((d) => existsSync(join(d, file)));
  return dir === undefined ? null : readFileSync(join(dir, file), "utf-8");
}
