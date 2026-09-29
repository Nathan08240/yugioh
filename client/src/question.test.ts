import { OcgHintTiming, OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, OcgType, SelectBattleCMDAction } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { newBoard, type EngineMessage, type Message } from "./board.ts";
import type { Cards } from "./cards.ts";
import { interaction } from "./Question.tsx";
import { apercuCombat, attaquantChoisi, autoAnswer, freePlaces, placeKey, reponseVisee } from "./question.ts";

const { MZONE, SZONE } = OcgLocation;

it("liste les zones libres d'après le masque du moteur", () => {
  // Masks sent by the engine: monster zone 1 taken, then S/T zones 1-2 taken.
  expect(freePlaces(0, 4294967265)).toEqual([1, 2, 3, 4].map((sequence) => ({ controller: 0, location: MZONE, sequence })));
  expect(freePlaces(1, 0xffffffff & ~(0b111000 << 8))).toEqual([3, 4, 5].map((sequence) => ({ controller: 1, location: SZONE, sequence })));
  // Opponent zones come after 16 bits, from the asking player's point of view.
  expect(freePlaces(1, 0xffffffff & ~(1 << 16))).toEqual([{ controller: 0, location: MZONE, sequence: 0 }]);
});

it("passe tout seul une chaîne sans carte à activer", () => {
  const chain: Message = { type: OcgMessageType.SELECT_CHAIN, player: 0, spe_count: 0, forced: false, hint_timing: OcgHintTiming.DRAW_PHASE, hint_timing_other: OcgHintTiming.DRAW_PHASE, selects: [] };
  expect(autoAnswer(chain)).toEqual({ type: OcgResponseType.SELECT_CHAIN, index: null });
  expect(autoAnswer({ ...chain, forced: true })).toBeUndefined();
  expect(autoAnswer({ type: OcgMessageType.SELECT_YESNO, player: 0, description: "0" })).toBeUndefined();
});

it("distingue par leur code les cartes hors du duel, toutes en séquence 0", () => {
  const outside = [153000001, 153000004].map((code) => placeKey({ controller: 0, location: 0 as OcgLocation, sequence: 0, code }));
  expect(new Set(outside).size).toBe(2);
  expect(placeKey({ controller: 1, location: MZONE, sequence: 2 })).toBe(`1:${MZONE}:2`);
});

const { HAND } = OcgLocation;
const key = (controller: number, location: OcgLocation, sequence: number) => placeKey({ controller, location, sequence });
const at = (controller: number, location: OcgLocation, sequence: number, code: number) => ({ controller: controller as 0 | 1, location, sequence, code });
const cards: Cards = new Map([
  [10, { type: OcgType.MONSTER } as CardInfo],
  [20, { type: OcgType.SPELL } as CardInfo],
  [30, { type: OcgType.MONSTER | OcgType.EFFECT } as CardInfo],
]);

function ui(question: EngineMessage, picked: string[] = [], cible?: string) {
  const board = newBoard(8000, [40, 40]);
  board.players[0].monsters[0] = { code: 10, position: OcgPosition.FACEUP_ATTACK };
  board.players[1].monsters[2] = { code: 10, position: OcgPosition.FACEUP_ATTACK };
  return interaction(question, { board, cards, strings: new Map(), picked, cible, setPicked: () => {}, respond: () => {} });
}
const labels = (choices: { label: string }[] | undefined) => choices?.map((choice) => choice.label);

it("retient au dépôt d'une carte de la main les actions qui la mènent à cette zone libre", () => {
  const idle: EngineMessage = {
    type: OcgMessageType.SELECT_IDLECMD,
    player: 0,
    summons: [at(0, HAND, 0, 10)],
    special_summons: [],
    pos_changes: [at(0, MZONE, 0, 10)],
    monster_sets: [at(0, HAND, 0, 10)],
    spell_sets: [at(0, HAND, 1, 20)],
    activates: [
      { ...at(0, HAND, 1, 20), description: "0", client_mode: 0 },
      { ...at(0, HAND, 2, 30), description: "0", client_mode: 0 },
    ],
    to_bp: true,
    to_ep: true,
    shuffle: false,
  };
  const { deposer } = ui(idle);
  expect(labels(deposer?.(key(0, HAND, 0), key(0, MZONE, 1)))).toEqual(["Invoquer", "Poser"]);
  for (const zone of [key(0, MZONE, 0), key(0, SZONE, 1), key(1, MZONE, 1)]) expect(deposer?.(key(0, HAND, 0), zone)).toEqual([]);
  expect(labels(deposer?.(key(0, HAND, 1), key(0, SZONE, 2)))).toEqual(["Poser", "Activer"]);
  // Only a Field Spell goes to the Field Zone; a monster's effect goes to no zone; a card of the field does not move.
  expect(deposer?.(key(0, HAND, 1), key(0, SZONE, 5))).toEqual([]);
  expect(deposer?.(key(0, HAND, 2), key(0, SZONE, 2))).toEqual([]);
  expect(deposer?.(key(0, MZONE, 0), key(0, MZONE, 1))).toEqual([]);
  // The bubble shows every action of the picked card, or only the ones of the zone it was dropped on.
  expect(labels(ui(idle, [key(0, HAND, 0)]).bulle)).toEqual(["Invoquer", "Poser"]);
  expect(labels(ui(idle, [key(0, HAND, 1)], key(0, SZONE, 2)).bulle)).toEqual(["Poser", "Activer"]);
  expect(ui(idle).bulle).toEqual([]);
});

it("attaque le monstre adverse sur lequel on lâche, ou directement ailleurs du côté adverse si c'est permis", () => {
  const battle: EngineMessage = {
    type: OcgMessageType.SELECT_BATTLECMD,
    player: 0,
    chains: [],
    attacks: [
      { ...at(0, MZONE, 0, 10), can_direct: false },
      { ...at(0, MZONE, 1, 10), can_direct: true },
    ],
    to_m2: true,
    to_ep: true,
  };
  const { deposer } = ui(battle);
  expect(labels(deposer?.(key(0, MZONE, 0), key(1, MZONE, 2)))).toEqual(["Attaquer"]);
  for (const cible of ["1", key(1, MZONE, 3), key(0, MZONE, 3)]) expect(deposer?.(key(0, MZONE, 0), cible)).toEqual([]);
  for (const cible of ["1", key(1, MZONE, 3), `1:${OcgLocation.GRAVE}`]) expect(labels(deposer?.(key(0, MZONE, 1), cible))).toEqual(["Attaquer"]);
});

it("répond à la question suivante avec la zone ou la cible du dépôt, si elle la propose", () => {
  const place: EngineMessage = { type: OcgMessageType.SELECT_PLACE, player: 0, count: 1, field_mask: ~(1 << 1) >>> 0 };
  expect(reponseVisee(place, key(0, MZONE, 1))).toEqual({ type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: MZONE, sequence: 1 }] });
  expect(reponseVisee(place, key(0, MZONE, 2))).toBeUndefined();
  expect(reponseVisee({ ...place, count: 2 }, key(0, MZONE, 1))).toBeUndefined();
  const target: EngineMessage = { type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, min: 1, max: 1, selects: [1, 2].map((sequence) => ({ ...at(1, MZONE, sequence, 10), position: OcgPosition.FACEUP_ATTACK })) };
  expect(reponseVisee(target, key(1, MZONE, 2))).toEqual({ type: OcgResponseType.SELECT_CARD, indicies: [1] });
  expect(reponseVisee(target, key(1, MZONE, 3))).toBeUndefined();
  // "Attack directly?": yes for a drop beside the monsters, no for a drop on one of them.
  const direct: EngineMessage = { type: OcgMessageType.SELECT_YESNO, player: 0, description: "31" };
  expect(reponseVisee(direct, "1")).toEqual({ type: OcgResponseType.SELECT_YESNO, yes: true });
  expect(reponseVisee(direct, key(1, MZONE, 2))).toEqual({ type: OcgResponseType.SELECT_YESNO, yes: false });
  expect(reponseVisee({ ...direct, description: "30" }, "1")).toBeUndefined();
  expect(reponseVisee({ type: OcgMessageType.SELECT_POSITION, player: 0, code: 10, positions: OcgPosition.FACEUP_ATTACK }, "1")).toBeUndefined();
});

const { FACEUP_ATTACK, FACEUP_DEFENSE, FACEDOWN_DEFENSE } = OcgPosition;
const monstre = (position: number, atk?: number, def?: number) => ({ code: 10, position, atk, def });
const apercu = (attaquant: ReturnType<typeof monstre>, cible: ReturnType<typeof monstre> | null) => apercuCombat(cards, attaquant, cible, "Kaiba");

it("annonce les dégâts d'une attaque directe", () => {
  expect(apercu(monstre(FACEUP_ATTACK, 1800), null)).toBe("1800 dégâts à Kaiba.");
});

it("compare ATK et ATK : gagnant, perdant, égalité", () => {
  const adverse = monstre(FACEUP_ATTACK, 1500, 1000);
  expect(apercu(monstre(FACEUP_ATTACK, 1800), adverse)).toBe("Le monstre adverse est détruit, 300 dégâts à Kaiba.");
  expect(apercu(monstre(FACEUP_ATTACK, 1200), adverse)).toBe("Votre monstre est détruit, 300 dégâts pour vous.");
  expect(apercu(monstre(FACEUP_ATTACK, 1500), adverse)).toBe("Les deux monstres sont détruits, pas de dégâts.");
});

it("compare ATK et DEF, avec renvoi de dégâts seulement si la DEF est plus haute", () => {
  const defense = monstre(FACEUP_DEFENSE, 500, 2000);
  expect(apercu(monstre(FACEUP_ATTACK, 2500), defense)).toBe("Le monstre adverse est détruit, pas de dégâts.");
  expect(apercu(monstre(FACEUP_ATTACK, 2000), defense)).toBe("Aucun monstre détruit, pas de dégâts.");
  expect(apercu(monstre(FACEUP_ATTACK, 1700), defense)).toBe("Aucun monstre détruit, 300 dégâts pour vous.");
});

it("ne révèle rien d'un monstre face cachée, même si ses stats sont connues", () => {
  expect(apercu(monstre(FACEUP_ATTACK, 1800), monstre(FACEDOWN_DEFENSE, 100, 100))).toBe("Monstre face cachée : DEF inconnue (?). Restez prudent.");
});

it("se rabat sur les stats imprimées, et se tait si elles sont inconnues", () => {
  const imprimees: Cards = new Map([[10, { atk: 1000, def: 800 } as CardInfo], [30, { atk: -2, def: 0 } as CardInfo]]);
  expect(apercuCombat(imprimees, monstre(FACEUP_ATTACK), monstre(FACEUP_DEFENSE), "Kaiba")).toBe("Le monstre adverse est détruit, pas de dégâts.");
  expect(apercuCombat(imprimees, { code: 30, position: FACEUP_ATTACK }, null, "Kaiba")).toBeUndefined();
});

it("retient l'attaquant choisi jusqu'à la question de la cible", () => {
  const battle: EngineMessage = {
    type: OcgMessageType.SELECT_BATTLECMD,
    player: 0,
    chains: [],
    attacks: [{ ...at(0, MZONE, 3, 10), can_direct: true }],
    to_m2: true,
    to_ep: true,
  };
  const attaque = { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 } as const;
  expect(attaquantChoisi(battle, attaque)).toBe(key(0, MZONE, 3));
  expect(attaquantChoisi(battle, { ...attaque, action: SelectBattleCMDAction.TO_EP, index: null })).toBeUndefined();
  const directe: EngineMessage = { type: OcgMessageType.SELECT_YESNO, player: 0, description: "31" };
  expect(attaquantChoisi(directe, { type: OcgResponseType.SELECT_YESNO, yes: false }, "0:4:3")).toBe("0:4:3");
  expect(attaquantChoisi(undefined, attaque)).toBeUndefined();
});
