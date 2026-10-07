import { expect, it } from "vitest";
import { cardInfo, clientCard } from "../src/cards.ts";
import { isExtraDeck } from "../src/deckcheck.ts";
import { POOL } from "../src/pool.ts";

const SUMMONED_SKULL = 70781052;
const REDEYES_B_DRAGON = 74677422;

it("sert le nom et le texte français d'une carte, avec ses libellés français", () => {
  expect(clientCard(46986414)).toMatchObject({
    name: "Magicien Sombre",
    desc: "Mage suprême en termes d'attaque et de défense.",
    attributeName: "TÉNÈBRES",
    typeLine: "Magicien / Normal",
    atk: 2500,
  });
  // Mystical Space Typhoon: YGOJSON writes the passcode 05318639.
  expect(clientCard(5318639)?.name).toBe("Typhon d'Espace Mystique");
});

it("garde le texte anglais de BabelCDB pour une carte sans traduction", () => {
  const anime = 511600399; // Slifer the Sky Dragon (Anime), in the pool through the story decks
  expect(clientCard(anime)).toMatchObject({ desc: cardInfo(anime)?.desc });
  expect(clientCard(anime)?.name).toBe("Slifer, le Dragon Céleste");
  expect(clientCard(511600398)?.name).toBe("Obelisk, le Tourmenteur");
  expect(clientCard(511600400)?.name).toBe("Le Dragon Ailé de Râ");
  // Wolf Axwielder: YGOJSON has no French for it.
  expect(clientCard(56369281)?.name).toBe("Wolf Axwielder");
  // Throwstone Unit: a French name but no French text.
  expect(clientCard(76075810)).toMatchObject({ name: "Unité de Lance-Pierre", desc: cardInfo(76075810)?.desc });
});

it("lit les matériaux d'une Fusion dans son script : codes, noms CARD_*, répétitions", () => {
  // Black Skull Dragon names its materials with the constants of the scripts.
  expect(clientCard(11901678)?.materials).toEqual([SUMMONED_SKULL, REDEYES_B_DRAGON]);
  // Flame Swordsman: two passcodes.
  expect(clientCard(45231177)?.materials).toEqual([34460851, 44287299]);
  // Twin-Headed Thunder Dragon and Mokey Mokey King: one card, twice and three times (AddProcMixN).
  expect(clientCard(54752875)?.materials).toEqual([31786629, 31786629]);
  expect(clientCard(13803864)?.materials).toEqual([27288416, 27288416, 27288416]);
  // Not an Extra Deck monster: no materials.
  expect(clientCard(46986414)?.materials).toBeUndefined();
});

it("donne les matériaux de chaque Fusion du pool", () => {
  const fusions = [...POOL].filter((code) => isExtraDeck(cardInfo(code) ?? { type: 0 }));
  expect(fusions.length).toBeGreaterThan(40);
  for (const code of fusions) {
    const materials = clientCard(code)?.materials;
    expect(materials?.length, `${code} ${clientCard(code)?.name}`).toBeGreaterThanOrEqual(2);
    expect(materials?.every((material) => cardInfo(material) !== undefined), `${code} : matériau inconnu`).toBe(true);
  }
});
