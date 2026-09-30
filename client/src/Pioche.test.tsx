import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Wonder } from "./lobby.ts";
import { Pioche } from "./Pioche.tsx";

const cards = [
  { code: 1, rarity: "common" },
  { code: 2, rarity: "rare" },
  { code: 3, rarity: "common" },
  { code: 4, rarity: "super" },
  { code: 5, rarity: "common" },
];
const render = (wonder: Exclude<Wonder, { status: "available" }>) =>
  renderToStaticMarkup(<Pioche wonder={wonder} send={() => {}} collection={() => {}} close={() => {}} />);

it("montre les cinq cartes face visible d'abord, sans pouvoir encore en choisir une", () => {
  const html = render({ type: "wonder", status: "drawn", cards });
  expect(html.match(/pioche__carte[ "]/g)).toHaveLength(5);
  expect(html).not.toContain("est-cachee");
  expect(html.match(/disabled=""/g)).toHaveLength(5);
  expect(html).toContain("Retourner les cartes");
});

it("affiche le résultat dans l'ordre face cachée, la carte choisie marquée", () => {
  const html = render({ type: "wonder", status: "picked", cards, shuffle: [4, 3, 2, 1, 0], picked: 1 });
  expect(html.match(/est-choisie/g)).toHaveLength(1);
  expect(html.indexOf("Carte face cachée 2")).toBeGreaterThan(-1);
  expect(html).toContain("Voir la collection");
});
