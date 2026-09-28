// Clone or update external data into server/vendor/: card scripts and database, EDOPro strings, YGOJSON (sets and French texts).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const vendor = join(import.meta.dirname, "..", "vendor");
const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" });

// Shallow clone, reduced to `paths` by a sparse checkout when given.
function clone(name: string, url: string, paths: string[] = [], branch: string[] = []) {
  const dir = join(vendor, name);
  if (existsSync(dir)) {
    git("-C", dir, "pull", "--ff-only", "--depth", "1");
  } else if (paths.length === 0) {
    git("clone", "--depth", "1", url, dir);
  } else {
    git("clone", "--depth", "1", "--filter=blob:none", "--no-checkout", ...branch, url, dir);
    git("-C", dir, "sparse-checkout", "set", "--no-cone", ...paths);
    git("-C", dir, "checkout");
  }
}

for (const repo of ["CardScripts", "BabelCDB"]) clone(repo, `https://github.com/ProjectIgnis/${repo}.git`);
clone("Distribution", "https://github.com/ProjectIgnis/Distribution.git", ["/config/strings.conf", "/config/languages/Français/strings.conf"]);
clone("YGOJSON", "https://github.com/iconmaster5326/YGOJSON.git", ["/sets/*", "/cards/*", "/distributions/*"], ["-b", "v1/individual"]);

// French name and text by passcode (without YGOJSON's leading zeros), so the server reads one file instead of YGOJSON's 14 000.
type YgoCard = { text?: { fr?: { name?: string; effect?: string } }; passwords?: string[] };
const cards = join(vendor, "YGOJSON", "cards");
const texts: Record<string, { name: string; desc?: string }> = {};
for (const file of readdirSync(cards)) {
  const { text, passwords = [] }: YgoCard = JSON.parse(readFileSync(join(cards, file), "utf-8"));
  const name = text?.fr?.name;
  if (!name) continue;
  for (const passcode of passwords) texts[Number(passcode)] ??= { name, desc: text.fr?.effect };
}
const out = join(vendor, "cards-fr.json");
writeFileSync(out, JSON.stringify(texts));
console.log(`${Object.keys(texts).length} cartes en français dans ${out}`);
