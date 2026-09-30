import { OcgAttribute, OcgType } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { CardDetail } from "./Card.tsx";
import { DuelView } from "./cards.ts";
import { findKeywords, KeywordChips } from "./motscles.tsx";
import { allRules, Regles } from "./regles.tsx";

const ids = (typeLine: string, desc = "") => findKeywords(typeLine, desc).map((word) => word.id);

it("repère les mots-clés de la ligne de type, mot entier", () => {
  expect(ids("Magicien / Fusion / Effet")).toEqual(["effet", "fusion"]);
  expect(ids("Guerrier / Flip / Effet")).toEqual(["effet", "flip"]);
  expect(ids("Magie Jeu-Rapide")).toEqual(["jeu-rapide"]);
  expect(ids("Magie Continue")).toEqual(["continue"]);
  expect(ids("Piège Continue")).toEqual(["continue"]);
  expect(ids("Magie Equipement ")).toEqual(["equipement"]);
  expect(ids("Magie Terrain")).toEqual(["terrain"]);
  expect(ids("Piège Contre")).toEqual(["contre"]);
  expect(ids("Magicien / Normal")).toEqual([]);
});

it("repère les termes de jeu du texte, sans tenir compte de la casse", () => {
  expect(ids("Magie", "Sacrifiez 1 monstre ; bannissez-le : Banni jusqu'au Cimetière.")).toEqual(["sacrifice", "banni", "cimetiere"]);
  expect(ids("Guerrier / Effet", "FLIP : piochez 1 carte.")).toEqual(["effet", "flip"]);
  expect(ids("Démon", "Invoquez Spécialement 1 Jeton pendant la Battle Phase.")).toEqual(["speciale", "jeton", "battle"]);
  // The word "Terrain" of a text is not the Field Spell kind.
  expect(ids("Dragon / Effet", "Détruisez 1 carte sur le Terrain.")).toEqual(["effet"]);
});

it("montre les pastilles avec leur explication à l'état actif seulement, reliée par aria-describedby", () => {
  const chips = renderToStaticMarkup(<KeywordChips typeLine="Magie Continue" desc="" />);
  expect(chips).toContain('aria-label="Mots-clés"');
  expect(chips).toContain(">Continue</button>");
  expect(chips).not.toContain('role="tooltip"');
  expect(chips).not.toContain("aria-describedby");
  expect(renderToStaticMarkup(<KeywordChips typeLine="Magicien / Normal" desc="" />)).toBe("");
});

it("ajoute les mots-clés dans la fiche de la carte", () => {
  const card: CardInfo = {
    name: "Kuriboh",
    alias: 0,
    desc: "Défaussez cette carte : Sacrifiez-la.",
    type: OcgType.MONSTER | OcgType.EFFECT,
    level: 1,
    attribute: OcgAttribute.DARK,
    race: 2,
    atk: 300,
    def: 200,
    strings: [],
    attributeName: "TÉNÈBRES",
    typeLine: "Démon / Effet",
    image: false,
  };
  const html = renderToStaticMarkup(
    <DuelView value={{ cards: new Map([[1, card]]), show: () => {}, seat: 0 }}>
      <CardDetail code={1} />
    </DuelView>,
  );
  expect(html).toContain(">Effet</button>");
  expect(html).toContain(">Sacrifice</button>");
});

it("rend la page des règles : les bases ouvertes, les arcs de l'Histoire repliés", () => {
  const page = renderToStaticMarkup(<Regles />);
  for (const rule of allRules()) expect(page).toContain(rule.title);
  expect(page).toContain("4000 LP");
  expect(page).toContain("Règles du Royaume des Duellistes");
  expect(page.match(/<details[^>]* open=""/g)).toHaveLength(allRules().length - 3);
});
