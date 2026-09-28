import { OcgAttribute, OcgType } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { DuelView, effectText } from "./cards.ts";

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
const cards = new Map([[46986414, magician], [5318639, typhoon]]);
const render = (code: number, full = false) =>
  renderToStaticMarkup(
    <DuelView value={{ cards, show: () => {}, seat: 0 }}>
      <CardView code={code} full={full} />
    </DuelView>,
  );

it("dessine la carte avec ses libellés français et son illustration", () => {
  const full = render(46986414, true);
  for (const text of ["Magicien Sombre", "TÉNÈBRES", "★★★★★★★", "[Magicien / Normal]", "Mage suprême", "ATK/2500 DEF/2100", 'src="/api/art/46986414.jpg"']) {
    expect(full).toContain(text);
  }
  const compact = render(46986414);
  expect(compact).toContain("2500 / 2100");
  expect(compact).not.toContain("Mage suprême");
});

it("remplace l'illustration manquante par la ligne de type, et garde le dos des cartes cachées", () => {
  const spell = render(5318639);
  expect(spell).toContain("[Magie Jeu-Rapide]");
  expect(spell).not.toContain("<img");
  expect(render(0)).toContain('aria-label="carte face cachée"');
  expect(render(0)).not.toContain("face-name");
});

it("lit une description d'effet dans les chaînes de la carte ou dans les chaînes système du moteur", () => {
  const strings = new Map([[31, "Attaquer Directement?"]]);
  const withStrings = new Map([[46986414, { ...magician, strings: ["Piocher 1 carte"] }]]);
  expect(effectText(withStrings, strings, String(46986414n << 20n))).toBe("Piocher 1 carte");
  expect(effectText(withStrings, strings, "31")).toBe("Attaquer Directement?");
  expect(effectText(withStrings, strings, "32")).toBeUndefined();
});
