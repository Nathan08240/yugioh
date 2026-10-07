import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, OcgType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { newBoard, playAll, type EngineMessage } from "./board.ts";
import { DuelView } from "./cards.ts";
import { ExtraPanel } from "./ExtraDeck.tsx";
import { atHand, byOriginal, covers, listExtra, markOf, materialsOf, POLYMERIZATION, summonableFrom, summonSpell } from "./extraDeck.ts";

const { MONSTER, FUSION, SPELL, NORMAL } = OcgType;
const { HAND, MZONE, EXTRA, GRAVE } = OcgLocation;

const SUMMONED_SKULL = 70781052;
const REDEYES_B_DRAGON = 74677422;
const BLACK_SKULL_DRAGON = 11901678;
const TWIN_HEADED = 54752875;
const KURIBOH = 40640057;
const KURIBOH_ART = 40640058;

const card = (name: string, type: number, stats: Partial<CardInfo> = {}): CardInfo => ({
  name, alias: 0, desc: "", type, level: 4, attribute: 0, race: 0, atk: 1000, def: 1000, strings: [], attributeName: "", typeLine: "", image: false, ...stats,
});
// Materials as the server reads them from the scripts (server/test/cards.test.ts checks the real ones).
const cards = new Map<number, CardInfo>([
  [SUMMONED_SKULL, card("Crâne Invoqué", MONSTER | NORMAL)],
  [REDEYES_B_DRAGON, card("Dragon Noir aux Yeux Rouges", MONSTER | NORMAL)],
  [BLACK_SKULL_DRAGON, card("Dragon Crâne Noir", MONSTER | FUSION, { atk: 3200, materials: [SUMMONED_SKULL, REDEYES_B_DRAGON] })],
  [KURIBOH, card("Kuriboh", MONSTER | NORMAL)],
  [KURIBOH_ART, card("Kuriboh", MONSTER | NORMAL, { alias: KURIBOH })],
  [TWIN_HEADED, card("Dragon Tonnerre à Deux Têtes", MONSTER | FUSION, { atk: 2800, materials: [KURIBOH, KURIBOH] })],
  [POLYMERIZATION, card("Polymérisation", SPELL)],
]);
const black = cards.get(BLACK_SKULL_DRAGON) as CardInfo;
const twin = cards.get(TWIN_HEADED) as CardInfo;

describe("matériaux d'un monstre de l'Extra Deck", () => {
  it("les regroupe par carte avec le nombre d'exemplaires", () => {
    expect(materialsOf(black)).toEqual([{ code: SUMMONED_SKULL, copies: 1 }, { code: REDEYES_B_DRAGON, copies: 1 }]);
    expect(materialsOf(twin)).toEqual([{ code: KURIBOH, copies: 2 }]);
    expect(materialsOf(card("Sans matériaux nommés", MONSTER | FUSION))).toBeUndefined();
  });

  it("compte une autre illustration comme la carte qu'elle reproduit", () => {
    expect(byOriginal([[KURIBOH, 1], [KURIBOH_ART, 1]], cards).get(KURIBOH)).toBe(2);
    expect(covers(twin, byOriginal([[KURIBOH, 1], [KURIBOH_ART, 1]], cards))).toBe(true);
    expect(covers(twin, byOriginal([[KURIBOH, 1]], cards))).toBe(false);
  });

  it("marque chaque matériau : dans le deck, possédé, manquant", () => {
    const main = new Map([[SUMMONED_SKULL, 1]]);
    const owned = new Map([[SUMMONED_SKULL, 1], [REDEYES_B_DRAGON, 2]]);
    expect(markOf({ code: SUMMONED_SKULL, copies: 1 }, main, owned)).toBe("deck");
    expect(markOf({ code: REDEYES_B_DRAGON, copies: 1 }, main, owned)).toBe("owned");
    expect(markOf({ code: KURIBOH, copies: 1 }, main, owned)).toBe("missing");
    // Two copies needed, one in the main deck: owned if the collection has two.
    expect(markOf({ code: KURIBOH, copies: 2 }, new Map([[KURIBOH, 1]]), new Map([[KURIBOH, 2]]))).toBe("owned");
  });

  it("le deck principal invoque avec Polymérisation et tous les matériaux", () => {
    const main = new Map([[POLYMERIZATION, 1], [SUMMONED_SKULL, 1], [REDEYES_B_DRAGON, 1]]);
    expect(summonableFrom(black, main)).toBe(true);
    expect(summonableFrom(black, new Map([...main].filter(([code]) => code !== POLYMERIZATION)))).toBe(false);
    expect(summonableFrom(black, new Map([...main].filter(([code]) => code !== SUMMONED_SKULL)))).toBe(false);
  });
});

describe("Extra Deck pendant un duel", () => {
  const board = playAll(newBoard(4000, [40, 40], [2, 3], { seat: 0, extra: [BLACK_SKULL_DRAGON, TWIN_HEADED] }), [
    { type: OcgMessageType.DRAW, player: 0, drawn: [SUMMONED_SKULL, POLYMERIZATION, KURIBOH].map((code) => ({ code, position: OcgPosition.FACEDOWN })) },
    { type: OcgMessageType.MOVE, card: REDEYES_B_DRAGON, from: { controller: 0, location: GRAVE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, to: { controller: 0, location: MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK } },
  ]);

  it("ne garde que le contenu de l'Extra Deck du joueur, jamais celui de l'adversaire", () => {
    expect(board.players[0].extraCards).toEqual([BLACK_SKULL_DRAGON, TWIN_HEADED]);
    expect(board.players[1].extraCards).toBeUndefined();
    expect(board.players.map((side) => side.extra)).toEqual([2, 3]);
  });

  it("retire de la liste le monstre invoqué et y remet celui qui revient", () => {
    const summon = { type: OcgMessageType.MOVE, card: BLACK_SKULL_DRAGON, from: { controller: 0, location: EXTRA, sequence: 0, position: OcgPosition.FACEDOWN }, to: { controller: 0, location: MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK } } as const;
    const after = playAll(board, [summon]);
    expect(after.players[0].extraCards).toEqual([TWIN_HEADED]);
    expect(after.players[0].extra).toBe(1);
    // The original board is untouched.
    expect(board.players[0].extraCards).toHaveLength(2);
    const back = playAll(after, [{ ...summon, from: summon.to, to: summon.from }]);
    expect(back.players[0].extraCards).toEqual([TWIN_HEADED, BLACK_SKULL_DRAGON]);
  });

  it("lit la main et le terrain du joueur seulement", () => {
    expect(Object.fromEntries(atHand(board.players[0], cards))).toEqual({ [SUMMONED_SKULL]: 1, [POLYMERIZATION]: 1, [KURIBOH]: 1, [REDEYES_B_DRAGON]: 1 });
    // The opponent's hidden hand (code 0) counts for nothing.
    expect(atHand(board.players[1], cards).size).toBe(0);
  });

  it("liste les monstres invocables d'abord, avec l'état de chaque matériau", () => {
    const listed = listExtra(board.players[0].extraCards ?? [], atHand(board.players[0], cards), cards);
    expect(listed.map(({ code, reunited }) => [code, reunited])).toEqual([[BLACK_SKULL_DRAGON, true], [TWIN_HEADED, false]]);
    expect(listed[1].materials).toEqual([{ code: KURIBOH, copies: 2, have: false }]);
  });

  it("propose Polymérisation seulement quand le moteur l'offre à la phase de jeu", () => {
    const place = { controller: 0, location: HAND, sequence: 1, description: "0" };
    const idle = (activates: object[]) => ({ type: OcgMessageType.SELECT_IDLECMD, player: 0, activates, summons: [], special_summons: [], pos_changes: [], monster_sets: [], spell_sets: [], to_bp: true, to_ep: true, can_shuffle: false }) as unknown as EngineMessage;
    expect(summonSpell(idle([{ ...place, code: KURIBOH }]))).toBeUndefined();
    expect(summonSpell(idle([{ ...place, code: KURIBOH }, { ...place, code: POLYMERIZATION }]))).toEqual({
      code: POLYMERIZATION,
      response: { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 1 },
    });
    expect(summonSpell(undefined)).toBeUndefined();
  });

  it("le panneau met en avant ce qui s'invoque tout de suite et offre le raccourci", () => {
    const listed = listExtra(board.players[0].extraCards ?? [], atHand(board.players[0], cards), cards);
    const html = (spell?: { code: number; activate: () => void }) =>
      renderToStaticMarkup(
        <DuelView value={{ cards, show: () => {}, seat: 0 }}>
          <ExtraPanel listed={listed} spell={spell} close={() => {}} />
        </DuelView>,
      );
    const ready = html({ code: POLYMERIZATION, activate: () => {} });
    expect(ready).toContain("Activer Polymérisation");
    expect(ready).toContain("Invocable maintenant");
    // The second monster lacks a material: none of the two words, whatever the spell.
    expect(ready.match(/Invocable maintenant/g)).toHaveLength(1);
    expect(ready).toContain("Absent");
    const without = html();
    expect(without).not.toContain("Activer");
    expect(without).not.toContain("Invocable maintenant");
    expect(without).toContain("Matériaux réunis");
  });
});
