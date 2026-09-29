import { OcgAttribute, OcgLocation, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { DuelView, effectText, strongest } from "./cards.ts";

const magician: CardInfo = {
  name: "Magicien Sombre",
  alias: 0,
  desc: "Mage suprême en termes d'attaque et de défense.",
  type: OcgType.MONSTER | OcgType.NORMAL,
  level: 7,
  attribute: OcgAttribute.DARK,
  race: 2,
  atk: 2500,
  def: 2100,
  strings: [],
  attributeName: "TÉNÈBRES",
  typeLine: "Magicien / Normal",
  image: true,
};
const typhoon: CardInfo = { ...magician, name: "Typhon d'Espace Mystique", type: OcgType.SPELL | OcgType.QUICKPLAY, typeLine: "Magie Jeu-Rapide", image: false };
const kuriboh: CardInfo = { ...magician, name: "Kuriboh", type: OcgType.MONSTER | OcgType.EFFECT, level: 1, atk: 300, def: 200 };
const skull: CardInfo = { ...magician, name: "Crâne Invoqué", level: 6 };
const cards = new Map([
  [70781052, skull],
  [46986414, magician],
  [5318639, typhoon],
  [40640057, kuriboh],
]);
const render = (element: ReactElement) => renderToStaticMarkup(<DuelView value={{ cards, show: () => {}, seat: 0 }}>{element}</DuelView>);

it("dessine la carte compacte : cadre du type, gemme d'attribut, niveau, nom et stats, illustration", () => {
  const compact = render(<CardView code={46986414} />);
  expect(compact).toContain('class="carte t-normal a-tenebres"');
  for (const text of ["Magicien Sombre", "Magicien / Normal", "icons.svg#attr-tenebres", 'aria-label="Niveau 7"', "ATK<b>2500</b>", "DEF<b>2100</b>", 'src="/api/art/46986414.jpg"']) {
    expect(compact).toContain(text);
  }
  expect(compact).not.toContain("Mage suprême");
});

it("ajoute le texte dans la version complète, en italique pour un monstre normal", () => {
  const full = render(<CardView code={46986414} full />);
  expect(full).toMatch(/^<article class="detail"><div class="carte /);
  for (const text of ["<h3>Magicien Sombre</h3>", "TÉNÈBRES · Niveau 7 · Magicien / Normal", 'class="detail__desc saveur"', "Mage suprême"]) {
    expect(full).toContain(text);
  }
  expect(render(<CardView code={40640057} full />)).toContain('class="detail__desc"');
});

it("traite la rareté de l'impression : rien pour une commune, un traitement à partir de la Rare", () => {
  expect(render(<CardView code={46986414} rarity="common" />)).toContain('class="carte t-normal a-tenebres"');
  expect(render(<CardView code={46986414} rarity="shortprint" />)).not.toContain(" r-");
  expect(render(<CardView code={46986414} rarity="rare" />)).toContain(" r-rare");
  expect(render(<CardView code={46986414} rarity="secret" />)).toContain(" r-secret");
});

it("remplace l'illustration manquante par l'icône de la Magie, sans stats ni niveau", () => {
  const spell = render(<CardView code={5318639} />);
  expect(spell).toContain('class="carte t-magie"');
  expect(spell).toContain('class="ic carte__repli"');
  expect(spell).toContain("icons.svg#type-magie");
  expect(spell).not.toContain("<img");
  expect(spell).not.toContain("carte__stats");
  expect(spell).not.toContain("carte__niveau");
});

it("montre le dos des cartes cachées et voile les cartes posées par le joueur", () => {
  const hidden = render(<CardView code={0} position={OcgPosition.FACEDOWN_DEFENSE} location={OcgLocation.MZONE} />);
  expect(hidden).toBe('<div class="carte est-defense dos" role="img" aria-label="carte face cachée"></div>');
  const set = render(<CardView code={40640057} position={OcgPosition.FACEDOWN_DEFENSE} location={OcgLocation.MZONE} />);
  expect(set).toContain('class="carte est-defense est-posee t-effet a-tenebres"');
  // In the hand, a card is never turned nor veiled.
  expect(render(<CardView code={40640057} position={OcgPosition.FACEDOWN_DEFENSE} location={OcgLocation.HAND} />)).toContain('class="carte t-effet');
  expect(render(<CardView code={40640057} className="est-cible" />)).toContain('class="carte est-cible t-effet');
});

it("montre un deck par ses monstres les plus forts, chacun une fois", () => {
  expect(strongest([40640057, 5318639, 46986414, 46986414, 40640057], cards, 5)).toEqual([46986414, 40640057]);
  // Same ATK: the higher level first.
  expect(strongest([70781052, 46986414], cards, 2)).toEqual([46986414, 70781052]);
  expect(strongest([40640057, 46986414], cards, 1)).toEqual([46986414]);
});

it("lit une description d'effet dans les chaînes de la carte ou dans les chaînes système du moteur", () => {
  const strings = new Map([[31, "Attaquer Directement?"]]);
  const withStrings = new Map([[46986414, { ...magician, strings: ["Piocher 1 carte"] }]]);
  expect(effectText(withStrings, strings, String(46986414n << 20n))).toBe("Piocher 1 carte");
  expect(effectText(withStrings, strings, "31")).toBe("Attaquer Directement?");
  expect(effectText(withStrings, strings, "32")).toBeUndefined();
});
