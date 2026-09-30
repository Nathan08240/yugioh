import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { beyondGoat, goatCompliant, GoatReminder, GoatStatus } from "./goat.tsx";

const info = (name: string): CardInfo => ({ name, image: true, type: 2, alias: 0, desc: "", level: 0, attribute: 0, race: 0, atk: 0, def: 0, strings: [], attributeName: "", typeLine: "" });
// Pot of Greed is limited and Raigeki forbidden on the Goat list; Flame Swordsman is free.
const POT = 55144522;
const RAIGEKI = 12580477;
const FREE = 45231177;
const cards = new Map([[POT, info("Pot de Cupidité")], [RAIGEKI, info("Raigeki")], [FREE, info("Spadassin des Flammes")]]);
const deck = (...main: number[]) => ({ main, extra: [] });

it("compte les cartes au-delà de la liste : exemplaires en trop d'une carte limitée, cartes interdites", () => {
  expect(beyondGoat(deck(POT, FREE, FREE, FREE), cards)).toBe(0);
  expect(beyondGoat(deck(POT, POT, POT), cards)).toBe(2);
  expect(beyondGoat(deck(POT, POT, RAIGEKI), cards)).toBe(2);
});

it("indique dans le deck builder si le deck est conforme ou combien de cartes dépassent", () => {
  expect(renderToStaticMarkup(<GoatStatus deck={deck(POT, FREE)} cards={cards} />)).toContain("Classé : conforme");
  const html = renderToStaticMarkup(<GoatStatus deck={deck(POT, POT, RAIGEKI)} cards={cards} />);
  expect(html).toContain("Classé : 2 cartes au-delà de la liste Goat");
  expect(html).toContain("Pot de Cupidité : 1 exemplaire au plus en classé ; Raigeki : interdite en classé");
  expect(renderToStaticMarkup(<GoatStatus deck={deck(POT, RAIGEKI)} cards={cards} />)).toContain("Classé : 1 carte au-delà");
});

it("rappelle, avec un lien vers le deck builder, que le deck actif n'est pas conforme, et se tait sinon", () => {
  const html = renderToStaticMarkup(<GoatReminder deck={deck(RAIGEKI)} cards={cards} where="en événement" go={() => {}} />);
  expect(html).toContain("Votre deck actif a 1 carte au-delà de la liste Goat, qui s&#x27;applique en événement.");
  expect(html).toContain("Modifier le deck");
  for (const quiet of [deck(FREE), undefined]) expect(renderToStaticMarkup(<GoatReminder deck={quiet} cards={cards} where="en classé" go={() => {}} />)).toBe("");
  // Cards not loaded yet: no claim either way.
  expect(renderToStaticMarkup(<GoatReminder deck={deck(RAIGEKI)} cards={new Map()} where="en classé" go={() => {}} />)).toBe("");
});

it("rend un deck conforme : retire les exemplaires en trop et complète à 40 avec des cartes possédées", () => {
  const monsters = Array.from({ length: 20 }, (_, index) => 1000 + index);
  const all = new Map([...cards, ...monsters.map((code): [number, CardInfo] => [code, { ...info(`Monstre ${code}`), type: 1 | 16, level: 4, atk: 1500 }])]);
  const owned = new Map([[POT, 3], [RAIGEKI, 1], [FREE, 3], ...monsters.map((code): [number, number] => [code, 3])]);
  const fixed = goatCompliant(deck(POT, POT, POT, RAIGEKI, FREE), all, owned);
  expect(fixed.main.filter((code) => code === POT)).toHaveLength(1);
  expect(fixed.main).not.toContain(RAIGEKI);
  expect(fixed.main).toContain(FREE);
  expect(fixed.main).toHaveLength(40);
  expect(beyondGoat(fixed, all)).toBe(0);
  expect(renderToStaticMarkup(<GoatStatus deck={deck(RAIGEKI)} cards={cards} fix={() => {}} />)).toContain("Rendre conforme");
});
