// Build data/sets.json from YGOJSON (set lists with rarities and booster slots, sourced from Yugipedia and YGOPRODeck).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCard } from "../src/cards.ts";

// TCG boosters from LOB up to FET (TLM brings the first Elemental HEROes), plus the 2002-2003 starter decks.
const CODES = new Set(["LOB", "MRD", "MRL", "PSV", "LON", "LOD", "PGD", "MFC", "DCR", "IOC", "AST", "SOD", "RDS", "FET", "SDY", "SDK", "SDJ", "SDP"]);

type Printing = { card: string; rarity: string };
type Content = { locales: string[]; distrobution?: string; cards: Printing[] };
type YgoSet = { name: { en: string }; locales?: Record<string, { prefix?: string; date?: string }>; contents: Content[] };

const dir = join(import.meta.dirname, "..", "vendor", "YGOJSON");
const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" });
if (existsSync(dir)) {
  git("-C", dir, "pull", "--ff-only", "--depth", "1");
} else {
  git("clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "-b", "v1/individual", "https://github.com/iconmaster5326/YGOJSON.git", dir);
  git("-C", dir, "sparse-checkout", "set", "--no-cone", "/sets/*", "/cards/*", "/distributions/*");
  git("-C", dir, "checkout");
}

const readJson = (...path: string[]) => JSON.parse(readFileSync(join(dir, ...path), "utf-8"));
// Alternate arts have their own passcode: keep the original one (no alias in BabelCDB).
function passcode(card: string): number {
  const codes = (readJson("cards", `${card}.json`) as { passwords: string[] }).passwords.map(Number);
  return codes.find((code) => readCard(code)?.alias === 0) ?? codes[0];
}

// Booster slots as in YGOJSON; starter decks are "preconstructed" and get none.
function boosterSlots(distribution?: string): object[] | undefined {
  if (distribution === "preconstructed") return undefined;
  const { quotas, slots } = readJson("distributions", `${distribution}.json`);
  if (quotas || slots.some((slot: Record<string, unknown>) => slot.type !== "pool" || slot.set || slot.cardTypes || slot.duplicates)) {
    throw new Error(`distribution ${distribution} non gérée`);
  }
  return slots;
}

const found = new Map<string, object>();
for (const file of readdirSync(join(dir, "sets"))) {
  const set: YgoSet = readJson("sets", file);
  // Original North American print; worldwide English replaces it from SOD on.
  const locale = set.locales?.na ? "na" : "en";
  const info = set.locales?.[locale];
  if (!info?.prefix || !info.date) continue;
  // "IOC-" is the booster, "IOC-SE" its Special Edition.
  const [code, region = ""] = info.prefix.split("-");
  if (!CODES.has(code) || (region !== "" && region !== "EN")) continue;
  if (found.has(code)) throw new Error(`plusieurs sets pour ${code}`);
  const content = set.contents.find((c) => c.locales.includes(locale));
  if (!content) throw new Error(`${code} : pas de liste de cartes ${locale}`);
  const cards = content.cards.map((p) => ({ code: passcode(p.card), rarity: p.rarity }));
  found.set(code, { code, name: set.name.en, date: info.date, slots: boosterSlots(content.distrobution), cards });
}

const missing = [...CODES].filter((code) => !found.has(code));
if (missing.length) throw new Error(`sets introuvables : ${missing.join(", ")}`);
const data = join(import.meta.dirname, "..", "data");
mkdirSync(data, { recursive: true });
const out = join(data, "sets.json");
writeFileSync(out, JSON.stringify([...CODES].map((code) => found.get(code)), null, 2) + "\n");
console.log(`${CODES.size} sets écrits dans ${out}`);
