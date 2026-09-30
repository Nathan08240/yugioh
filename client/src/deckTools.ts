import { isFusion, type DeckCard, type DeckDraft } from "../../server/src/deckcheck.ts";

export const HAND_SIZE = 5;

// EDOPro .ydk: "#main", "#extra" and "!side" headers, one passcode per line. Other "#" lines are comments.
export function formatYdk({ main, extra }: Pick<DeckDraft, "main" | "extra">): string {
  return ["#created by yugioh", "#main", ...main, "#extra", ...extra, "!side", ""].join("\n");
}

type Section = "main" | "extra" | "side";
export type Parsed = { main: number[]; extra: number[]; invalid: string[] };

// Side deck and comments are ignored; a list without headers is read as a main deck.
export function parseYdk(text: string): Parsed {
  const parsed: Parsed = { main: [], extra: [], invalid: [] };
  let section: Section = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line === "#main" || line === "#extra" || line === "!side") {
      section = line.slice(1) as Section;
    } else if (!line.startsWith("#") && !line.startsWith("!")) {
      const code = Number(line);
      if (!Number.isSafeInteger(code) || code <= 0) parsed.invalid.push(line);
      else if (section !== "side") parsed[section].push(code);
    }
  }
  return parsed;
}

export type Skipped = { code: number; reason: string };

// Fills a draft from parsed codes. Unknown, unowned or surplus cards are skipped and reported; the server still checks the save.
// Fusions always go to the extra deck, whatever section the file put them in.
export function importDeck(
  { main, extra }: Pick<Parsed, "main" | "extra">,
  card: (code: number) => DeckCard | undefined,
  owned: ReadonlyMap<number, number>,
): { main: number[]; extra: number[]; skipped: Skipped[] } {
  const result = { main: [] as number[], extra: [] as number[], skipped: [] as Skipped[] };
  const used = new Map<number, number>();
  for (const code of [...main, ...extra]) {
    const info = card(code);
    const count = used.get(code) ?? 0;
    const quantity = owned.get(code) ?? 0;
    if (!info) result.skipped.push({ code, reason: "hors pool" });
    else if (quantity === 0) result.skipped.push({ code, reason: "non possédée" });
    else if (count >= quantity) result.skipped.push({ code, reason: "trop d'exemplaires" });
    else {
      used.set(code, count + 1);
      result[isFusion(info) ? "extra" : "main"].push(code);
    }
  }
  return result;
}

// Partial Fisher-Yates on a copy: `random` returns [0, 1), injectable for tests.
export function drawHand(main: readonly number[], random: () => number = Math.random, size = HAND_SIZE): number[] {
  const pool = [...main];
  const count = Math.min(size, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
