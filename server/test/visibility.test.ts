import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage, type OcgMessageSelectCard } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { hideCards, visibleTo } from "../src/visibility.ts";

const card = (controller: 0 | 1, location: OcgLocation, position: OcgPosition) => ({ code: 123, controller, location, sequence: 0, position });

describe("filtrage des informations cachées", () => {
  it("masque les cartes adverses face cachée d'une question, pas les siennes", () => {
    const question: OcgMessageSelectCard = {
      type: OcgMessageType.SELECT_CARD,
      player: 0,
      can_cancel: false,
      min: 1,
      max: 1,
      selects: [card(1, OcgLocation.SZONE, OcgPosition.FACEDOWN_DEFENSE), card(1, OcgLocation.MZONE, OcgPosition.FACEUP_ATTACK), card(0, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE)],
    };
    const codes = hideCards(question, 0).selects.map((selected) => selected.code);
    expect(codes).toEqual([0, 123, 123]);
  });

  it("cache une carte qui part dans la main adverse, montre le cimetière", () => {
    const toHand = { controller: 1, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE } as const;
    const toGrave = { ...toHand, location: OcgLocation.GRAVE, position: OcgPosition.FACEUP_ATTACK } as const;
    const move = (to: typeof toHand | typeof toGrave): OcgMessage => ({ type: OcgMessageType.MOVE, card: 123, from: toHand, to });
    expect(visibleTo(move(toHand), 0)).toMatchObject({ card: 0 });
    expect(visibleTo(move(toHand), 1)).toMatchObject({ card: 123 });
    expect(visibleTo(move(toGrave), 0)).toMatchObject({ card: 123 });
  });
});
