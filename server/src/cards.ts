import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OcgCardData } from "@n1xx1/ocgcore-wasm";
import { isExtraDeck } from "./deckcheck.ts";
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

// The files never change while the server runs: each card and script is read once, the result shared by every caller.
function memo<K, V>(load: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, load(key));
    return cache.get(key) as V;
  };
}

const findRow = memo((code: number): Row | null => {
  for (const query of queries) {
    const row = query.get(code);
    if (row) return row as Row;
  }
  return null;
});

// The same object for every caller and duel: read only.
export const readCard = memo((code: number) => cardFromRow(code, findRow(code)));

// ponytail: no pendulum scales or link markers, classic cards only.
function cardFromRow(code: number, row: Row | null): OcgCardData | null {
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

// Cards YGOJSON lacks in French: the story's Extra Rules card (see EXTRA_RULES) and the anime Egyptian Gods (name only).
export const RULE_CARDS: ReadonlyMap<number, French> = new Map([
  [511600398, { name: "Obelisk, le Tourmenteur" }],
  [511600399, { name: "Slifer, le Dragon Céleste" }],
  [511600400, { name: "Le Dragon Ailé de Râ" }],
  [
    511002621,
    {
      name: "Règles du Royaume des Duellistes",
      desc: "Pas d'attaque directe.\n● Invocation Normale possible en Position de Défense face recto.\n● Les monstres de Niveau 5 ou plus s'invoquent ou se posent sans Tribut.\n● Un monstre détruit par un effet inflige à son contrôleur la moitié de son ATK en dégâts.\n● Un seul monstre peut déclarer une attaque par tour.\n● Qui n'invoque aucun monstre lors d'un tour où il n'en contrôle pas perd le duel à la fin de ce tour.",
    },
  ],
]);

// Written by `pnpm vendor` from YGOJSON.
function frenchText(code: number): French | undefined {
  if (!french) {
    const file = join(vendor, "cards-fr.json");
    if (!existsSync(file)) throw new Error("server/vendor/cards-fr.json absent : lancer `pnpm vendor`");
    const texts: Record<string, French> = JSON.parse(readFileSync(file, "utf-8"));
    french = new Map(Object.entries(texts).map(([passcode, text]) => [Number(passcode), text]));
  }
  return RULE_CARDS.get(code) ?? french.get(code);
}

// The card as the client shows it: French name and text, English from BabelCDB for a card YGOJSON does not translate
// (anime cards). Without `image`, which depends on the downloaded files.
export function clientCard(code: number): Omit<CardInfo, "image"> | undefined {
  const info = cardInfo(code);
  if (!info) return undefined;
  const text = frenchText(code);
  const materials = isExtraDeck(info) ? fusionMaterials(code) : undefined;
  return {
    ...info,
    name: text?.name ?? info.name,
    desc: text?.desc ?? info.desc,
    attributeName: attributeName(info.attribute),
    typeLine: typeLine(info.type, info.race),
    ...(materials && { materials }),
  };
}

const scriptDirs = ["", "official", "unofficial"].map((dir) => join(vendor, "CardScripts", dir));

const scriptFile = memo((file: string): string | null => {
  const dir = scriptDirs.find((d) => existsSync(join(d, file)));
  return dir === undefined ? null : readFileSync(join(dir, file), "utf-8");
});

export const readScript = (name: string) => scriptFile(name.split("/").at(-1) ?? name);

// The CARD_* names the scripts give to passcodes (CARD_DARK_MAGICIAN = 46986414).
const cardConstants = memo((file: string) => new Map([...(scriptFile(file) ?? "").matchAll(/^(CARD_\w+)\s*=\s*(\d+)/gm)].map(([, name, passcode]) => [name, Number(passcode)] as const)));

// Fusion.AddProcMix(c,substitute,insufficient,material,...) lists the materials; AddProcMixN takes (material,count) pairs.
const FUSION_MATERIALS = /Fusion\.AddProcMix(N?)\(c,[^,]*,[^,]*,([^)]*)\)/;

// The named materials of a Fusion monster, read from its script, one entry per card needed; undefined when one is a condition
// (a filter function). ponytail: Fusion Substitute is ignored; Synchro, Xyz and Link would add their own reader here.
const fusionMaterials = memo((code: number): number[] | undefined => {
  const [, counted, args] = FUSION_MATERIALS.exec(readScript(`c${code}.lua`) ?? "") ?? [];
  if (args === undefined) return undefined;
  const constants = cardConstants("card_counter_constants.lua");
  const values = args.split(",").map((arg) => Number(arg) || constants.get(arg.trim()));
  const named = values.filter((value) => value !== undefined);
  if (named.length !== values.length) return undefined;
  if (!counted) return named;
  return named.length % 2 === 0 ? named.flatMap((value, i) => (i % 2 === 0 ? Array<number>(named[i + 1]).fill(value) : [])) : undefined;
});
