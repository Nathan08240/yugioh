import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgType } from "@n1xx1/ocgcore-wasm";

const config = join(import.meta.dirname, "..", "vendor", "Distribution", "config");

// `!system <id> <text>` lines of an EDOPro strings.conf; the other keywords are ignored.
export function parseSystemStrings(text: string): Map<number, string> {
  const strings = new Map<number, string>();
  for (const line of text.split("\n")) {
    const [keyword, id, ...words] = line.trim().split(" ");
    if (keyword === "!system" && id && Number.isInteger(Number(id))) strings.set(Number(id), words.join(" ").trim());
  }
  return strings;
}

let system: ReadonlyMap<number, string> | undefined;

// EDOPro system strings in French, in English where the translation lacks one.
export function systemStrings(): ReadonlyMap<number, string> {
  system ??= new Map([
    ...parseSystemStrings(readFileSync(join(config, "strings.conf"), "utf-8")),
    ...parseSystemStrings(readFileSync(join(config, "languages", "Français", "strings.conf"), "utf-8")),
  ]);
  return system;
}

// System strings `base + bit` for each bit set in `mask`, lowest bit first (EDOPro: attributes 1010, races 1020, types 1050).
function labels(mask: number, base: number): string[] {
  const bits = Array.from({ length: 31 }, (_, bit) => bit).filter((bit) => (mask & (1 << bit)) !== 0);
  return bits.map((bit) => systemStrings().get(base + bit) ?? "");
}

export const attributeName = (attribute: number) => labels(attribute, 1010).join(" ");

const LAST = OcgType.NORMAL | OcgType.EFFECT;

// "Magicien / Normal", "Dragon / Fusion / Effet", "Magie Continue", "Piège Contre".
export function typeLine(type: number, race: number): string {
  if ((type & (OcgType.SPELL | OcgType.TRAP)) !== 0) return labels(type, 1050).join(" ");
  const kinds = labels(type & ~(OcgType.MONSTER | LAST), 1050);
  return [...labels(race, 1020), ...kinds, ...labels(type & LAST, 1050)].join(" / ");
}
