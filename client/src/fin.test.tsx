import { OcgAttribute, OcgLocation, OcgMessageType, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Message } from "./board.ts";
import { DuelView } from "./cards.ts";
import { Duel } from "./Duel.tsx";
import { Fin } from "./Fin.tsx";
import type { StoryWon } from "./lobby.ts";
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
const fin = (board: ReturnType<typeof finished>, special?: string[], seat = 0) => render(<Fin board={board} seat={seat} room="r" vsBot story={{ title: "Duel", special }} leave={() => {}} go={() => {}} onRematch={() => {}} />);

it("explique la défaite par la règle de destruction du Royaume : la carte, le monstre détruit, la moitié de l'ATK", () => {
  const html = fin(finished(1), ["duelist-kingdom"]);
  for (const text of ["Règle du Royaume", "Fissure", "a détruit Dragon Blanc aux Yeux Bleus", "vous perdez la moitié de son ATK", "1500 points de dégâts"]) expect(html).toContain(text);
  expect(html).not.toContain("Coup final");
});

it("nomme l'adversaire dans l'écran de défaite, avec un repli neutre", () => {
  const board = finished(1);
  const named = (opponent?: string) => render(<Fin board={board} seat={0} room="r" vsBot={false} opponent={opponent} leave={() => {}} go={() => {}} onRematch={() => {}} />);
  expect(named("Seto Kaiba")).toContain("Seto Kaiba l&#x27;emporte au tour");
  expect(named()).toContain("L&#x27;adversaire l&#x27;emporte au tour");
});

it("nomme l'adversaire dans la cause de fin, avec un repli neutre", () => {
  const board = finished(0, 0);
  const cause = (opponent?: string) => render(<Fin board={board} seat={0} room="r" vsBot={false} opponent={opponent} leave={() => {}} go={() => {}} onRematch={() => {}} />);
  expect(cause("Seto Kaiba")).toContain("Seto Kaiba a abandonné.");
  expect(cause()).toContain("L&#x27;adversaire a abandonné.");
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

it("indique le niveau Facile pendant le duel et sur l'écran de fin", () => {
  const board = finished(1, 0);
  const duel = (easy?: boolean) => render(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} easy={easy} />);
  expect(duel(true)).toContain("Facile");
  expect(duel()).not.toContain("Facile");
  const end = (easy: boolean) => render(<Fin board={board} seat={0} room="ABCDE" vsBot story={{ title: "Battle City · Duel 2 sur 3", easy }} leave={() => {}} go={() => {}} onRematch={() => {}} />);
  expect(end(true)).toContain("Battle City · Duel 2 sur 3 · Facile");
  expect(end(false)).not.toContain("Facile");
});

it("montre les étoiles obtenues, la suivante et la série de rejeu d'un duel d'histoire", () => {
  const board = finished(1, 0);
  const end = (won: StoryWon) =>
    render(<Fin board={board} seat={0} room="r" vsBot story={{ title: "Duel", won, lp: 4000 }} leave={() => {}} go={() => {}} onRematch={() => {}} />);
  const base = { type: "story_won", duel: "d", outro: "Fin.", rewards: null, starBooster: false } as const;
  const first = end({ ...base, rewards: { boosters: 1 }, stars: 2, best: 2 });
  for (const text of ['aria-label="2 étoiles sur 3"', "Gagnez en Normal avec au moins 2000 LP pour la 3e étoile.", "Ouvrir mes boosters"]) expect(first).toContain(text);
  expect(first).not.toContain("rejeu");
  const easy = end({ ...base, stars: 1, best: 2, replays: 2 });
  for (const text of ["Meilleure note : 2 étoiles.", "Victoires de rejeu : 2/3 avant le prochain booster.", "Récompenses déjà obtenues."]) expect(easy).toContain(text);
  expect(easy).not.toContain("Ouvrir mes boosters");
  const full = end({ ...base, stars: 3, best: 3, starBooster: true, replays: 3 });
  for (const text of ["3 étoiles : 1 booster gagné.", "Victoire de rejeu 3/3 : 1 booster gagné.", "Ouvrir mes boosters"]) expect(full).toContain(text);
  expect(full).not.toContain("Gagnez en Normal");
  expect(end({ ...base, stars: 1, best: 1 })).toContain("Gagnez en Normal pour la 2e étoile.");
});

it("montre le badge « Règles spéciales » d'un duel d'histoire seulement", () => {
  const board = finished(1);
  const duel = (rules?: ReturnType<typeof specialRules>) => render(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} rules={rules} />);
  const html = duel(specialRules(["duelist-kingdom"]));
  for (const text of ["Règles spéciales", "Règles du Royaume des Duellistes", "Pas d&#x27;attaque directe."]) expect(html).toContain(text);
  expect(duel(specialRules([]))).not.toContain("Règles spéciales");
  expect(duel()).not.toContain("Règles spéciales");
});

it("propose la revanche selon son état : à demander, en attente, à accepter ou refuser, refusée", () => {
  const board = finished(1);
  const online = (rematch?: Parameters<typeof Fin>[0]["rematch"]) => render(<Fin board={board} seat={0} room="r" vsBot={false} opponent="Seto Kaiba" rematch={rematch} leave={() => {}} go={() => {}} onRematch={() => {}} />);
  expect(online()).toContain("Revanche</button>");
  expect(online({ from: 0 })).toContain("Revanche demandée");
  const offered = online({ from: 1 });
  for (const text of ["Seto Kaiba propose une revanche", "Accepter", "Refuser"]) expect(offered).toContain(text);
  expect(online("declined")).toContain("Revanche refusée");
  // Against the bot the button restarts at once, whatever the online state.
  expect(fin(board)).toContain("Revanche</button>");
});
