// Download pool card images into server/vendor/images/ (gitignored: Konami artwork stays out of the repo).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { readCard } from "../src/cards.ts";
import { POOL } from "../src/pool.ts";

const dir = join(import.meta.dirname, "..", "vendor", "images");
mkdirSync(dir, { recursive: true });

let failed = 0;
for (const code of POOL) {
  const file = join(dir, `${code}.jpg`);
  if (existsSync(file)) continue;
  // Anime cards have no picture of their own: use the official card they alias.
  const alias = readCard(code)?.alias ?? 0;
  const res = await fetch(`https://images.ygoprodeck.com/images/cards/${alias > 0 ? alias : code}.jpg`);
  if (res.ok) {
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } else {
    console.error(`${code} : HTTP ${res.status}`);
    failed++;
  }
  await setTimeout(100); // YGOPRODeck rate-limits at 20 requests per second.
}
console.log(`${POOL.size - failed} images dans ${dir}, ${failed} échecs`);
