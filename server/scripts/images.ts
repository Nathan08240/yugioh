// Download the artwork of every served card, cropped without its frame, into server/vendor/art/ (gitignored: Konami artwork stays out of the repo).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { readCard } from "../src/cards.ts";
import { POOL } from "../src/pool.ts";
import { STORY } from "../src/story.ts";

const dir = join(import.meta.dirname, "..", "vendor", "art");
mkdirSync(dir, { recursive: true });

async function artwork(code: number): Promise<Buffer | undefined> {
  const res = await fetch(`https://images.ygoprodeck.com/images/cards_cropped/${code}.jpg`);
  await setTimeout(100); // YGOPRODeck rate-limits at 20 requests per second.
  return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
}

const served = new Set([...POOL, ...STORY.anime]);
let failed = 0;
for (const code of served) {
  const file = join(dir, `${code}.jpg`);
  if (existsSync(file)) continue;
  // An anime card has no artwork of its own: fall back on the official card it aliases.
  const alias = readCard(code)?.alias ?? 0;
  const image = (await artwork(code)) ?? (alias > 0 ? await artwork(alias) : undefined);
  if (image) {
    writeFileSync(file, image);
  } else {
    console.error(`${code} : illustration introuvable`);
    failed++;
  }
}
console.log(`${served.size - failed} illustrations dans ${dir}, ${failed} échecs`);
