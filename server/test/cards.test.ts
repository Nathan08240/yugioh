import { expect, it } from "vitest";
import { cardInfo, clientCard } from "../src/cards.ts";

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
