import { OcgRace, OcgType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { attributeName, parseSystemStrings, systemStrings, typeLine } from "../src/strings.ts";

it("lit les chaînes système d'un strings.conf EDOPro et ignore les autres mots-clés", () => {
  const conf = "# commentaire\r\n!system 30 Poursuivre l'attaque ?\r\n!victory 0x1 Abandon\n!counter 0x1 Compteur Magie\n!system 1068 Equipement \n";
  expect(parseSystemStrings(conf)).toEqual(new Map([[30, "Poursuivre l'attaque ?"], [1068, "Equipement"]]));
});

it("prend les chaînes françaises d'EDOPro, l'anglais là où la traduction manque", () => {
  const strings = systemStrings();
  expect(strings.get(31)).toBe("Attaquer Directement?");
  expect(strings.get(1015)).toBe("TÉNÈBRES");
  expect([...strings.values()].filter((text) => text.includes("Normal Summon"))).toEqual([]);
});

it("nomme attributs, types de monstres et types de cartes en français", () => {
  expect(attributeName(0x20)).toBe("TÉNÈBRES");
  expect(typeLine(OcgType.MONSTER | OcgType.NORMAL, Number(OcgRace.SPELLCASTER))).toBe("Magicien / Normal");
  expect(typeLine(OcgType.MONSTER | OcgType.EFFECT | OcgType.FUSION, Number(OcgRace.DRAGON))).toBe("Dragon / Fusion / Effet");
  expect(typeLine(OcgType.MONSTER | OcgType.EFFECT | OcgType.FLIP, Number(OcgRace.INSECT))).toBe("Insecte / Flip / Effet");
  expect(typeLine(OcgType.SPELL | OcgType.CONTINUOUS, 0)).toBe("Magie Continue");
  expect(typeLine(OcgType.SPELL | OcgType.QUICKPLAY, 0)).toBe("Magie Jeu-Rapide");
  expect(typeLine(OcgType.TRAP | OcgType.COUNTER, 0)).toBe("Piège Contre");
});
