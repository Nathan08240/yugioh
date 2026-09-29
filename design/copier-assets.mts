// Copie dans design/assets/ (non versionné) les illustrations et les données des cartes de la maquette.
// Usage depuis la racine du repo : node design/copier-assets.mts [dossier server contenant vendor/]
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const server = resolve(process.argv[2] ?? "server");
const { clientCard } = await import(pathToFileURL(join(server, "src", "cards.ts")).href);
const out = join(import.meta.dirname, "assets");
mkdirSync(join(out, "art"), { recursive: true });

const CODES = [
  46986414, 89631139, 74677422, 40640057, 70781052, 91152256, 38033121, 44095762, 55144522, 83764718, 72302403, 511600399, 511600398, 511600400,
  6368038, 4031928, 12580477, 53129443, 45231177, 33396948, 15025844, 71625222, 88819587, 41462083, 17985575, 4206964, 12607053, 26202165,
  64631466, 15259703, 13039848, 3643300, 76812113, 81480460, 40737112, 53839837, 93221206, 43973174, 24611934, 30113682, 12206212, 75356564, 14141448,
  16972957, 19066538, 43230671, 3819470, 39111158, 66889139, 24094653, 76184692, 90357090, 44287299, 83464209, 22702055, 37313348, 97590747,
  16956455, 3797883, 86327225, 94568601, 72989439, 28279543, 61441708,
];
// Dieux anime : nom et texte français de la carte originale.
const GODS = new Map([[511600399, 10000020], [511600398, 10000000], [511600400, 10000010]]);
const ATTRIBUTES = new Map([["LUMIÈRE", "lumiere"], ["TÉNÈBRES", "tenebres"], ["TERRE", "terre"], ["EAU", "eau"], ["FEU", "feu"], ["VENT", "vent"], ["DIVIN", "divin"]]);
const FRAMES: [number, string][] = [[0x4, "piege"], [0x2, "magie"], [0x4000, "jeton"], [0x40, "fusion"], [0x80, "rituel"], [0x20, "effet"]];

const cards: Record<number, unknown[]> = {};
for (const code of CODES) {
  copyFileSync(join(server, "vendor", "art", `${code}.jpg`), join(out, "art", `${code}.jpg`));
  const card = clientCard(code);
  const text = clientCard(GODS.get(code) ?? code);
  const frame = FRAMES.find(([flag]) => (card.type & flag) !== 0)?.[1] ?? "normal";
  cards[code] = [text.name, frame, ATTRIBUTES.get(card.attributeName) ?? "", card.level, card.atk, card.def, card.typeLine, text.desc];
}
writeFileSync(join(out, "cartes.js"), `// Généré par design/copier-assets.mts : nom, cadre, attribut, niveau, ATK, DEF, type, texte.\nexport const CARTES = ${JSON.stringify(cards, null, 1)};\n`);
console.log(`${CODES.length} cartes copiées dans ${out}`);
