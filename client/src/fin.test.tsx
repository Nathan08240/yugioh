import { OcgAttribute, OcgLocation, OcgMessageType, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Message } from "./board.ts";
import { DuelView } from "./cards.ts";
import { Duel } from "./Duel.tsx";
import { Fin } from "./Fin.tsx";
import { specialRules } from "./regles.tsx";

const DRAGON = 89631139;
const FISSURE = 66788016;
const { HAND, MZONE, SZONE, GRAVE } = OcgLocation;
const { FACEUP_ATTACK, FACEDOWN } = OcgPosition;
const info: CardInfo = { name: "", alias: 0, desc: "", type: OcgType.MONSTER, level: 8, attribute: OcgAttribute.LIGHT, race: 1, atk: 3000, def: 2500, strings: [], attributeName: "LUMIÈRE", typeLine: "Dragon", image: false };
const cards = new Map([
  [DRAGON, { ...info, name: "Dragon Blanc aux Yeux Bleus" }],
  [FISSURE, { ...info, name: "Fissure", type: OcgType.SPELL }],
]);
const render = (element: ReactElement) => renderToStaticMarkup(<DuelView value={{ cards, show: () => {}, seat: 0 }}>{element}</DuelView>);

// Player 0 has a 3000 ATK dragon, player 1 destroys it with Fissure: half its ATK hits player 0.
const empty = [null, null, null, null, null];
const messages: Message[] = [
  { type: OcgMessageType.DRAW, player: 0, drawn: [{ code: DRAGON, position: FACEDOWN }] },
  { type: OcgMessageType.MOVE, card: DRAGON, from: { controller: 0, location: HAND, sequence: 0, position: FACEDOWN }, to: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK } },
  { type: "stats", monsters: [[{ atk: 3000, def: 2500 }, ...empty.slice(1)], empty] },
  { type: OcgMessageType.CHAINING, code: FISSURE, controller: 1, location: SZONE, sequence: 0, position: FACEUP_ATTACK, triggering_controller: 1, triggering_location: SZONE, triggering_sequence: 0, description: "0", chain_size: 1 },
  { type: OcgMessageType.MOVE, card: DRAGON, from: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, to: { controller: 0, location: GRAVE, sequence: 0, position: FACEUP_ATTACK } },
  { type: OcgMessageType.DAMAGE, player: 0, amount: 1500 },
  { type: OcgMessageType.LPUPDATE, player: 0, lp: 0 },
];
const finished = (reason: number, winner = 1) => playAll(newBoard(1500, [40, 40]), [...messages, { type: OcgMessageType.WIN, player: winner, reason }]);
const fin = (board: ReturnType<typeof finished>, special?: string[], seat = 0) => render(<Fin board={board} seat={seat} room="r" vsBot story={{ title: "Duel", special }} leave={() => {}} go={() => {}} />);

it("explique la défaite par la règle de destruction du Royaume : la carte, le monstre détruit, la moitié de l'ATK", () => {
  const html = fin(finished(1), ["duelist-kingdom"]);
  for (const text of ["Règle du Royaume", "Fissure", "a détruit Dragon Blanc aux Yeux Bleus", "vous perdez la moitié de son ATK", "1500 points de dégâts"]) expect(html).toContain(text);
  expect(html).not.toContain("Coup final");
});

it("garde le coup final ordinaire hors du Royaume", () => {
  const html = fin(finished(1));
  expect(html).toContain("Coup final");
  expect(html).not.toContain("Règle du Royaume");
});

it("donne la vraie cause d'une défaite qui n'est pas une perte de LP, sans coup final trompeur", () => {
  const noMonster = fin(finished(0x5a), ["duelist-kingdom"]);
  expect(noMonster).toContain("Vous avez fini votre tour sans monstre et sans en avoir invoqué");
  expect(noMonster).not.toContain("Coup final");
  expect(fin(finished(2))).toContain("Vous n&#x27;avez plus de carte à piocher.");
  expect(fin(finished(0))).toContain("Vous avez abandonné.");
  expect(fin(finished(0x99))).toContain("effet d&#x27;une carte ou d&#x27;une règle spéciale");
  // Victory by the opponent's mistake.
  const won = fin(finished(0x5a, 0));
  expect(won).toContain("L&#x27;adversaire a fini son tour sans monstre");
  expect(fin(finished(1, 0))).not.toContain("fin__note");
});

it("montre le badge « Règles spéciales » d'un duel d'histoire seulement", () => {
  const board = finished(1);
  const duel = (rules?: ReturnType<typeof specialRules>) => render(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} rules={rules} />);
  const html = duel(specialRules(["duelist-kingdom"]));
  for (const text of ["Règles spéciales", "Règles du Royaume des Duellistes", "Pas d&#x27;attaque directe."]) expect(html).toContain(text);
  expect(duel(specialRules([]))).not.toContain("Règles spéciales");
  expect(duel()).not.toContain("Règles spéciales");
});
