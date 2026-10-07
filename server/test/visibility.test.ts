import { OcgHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgMessage, type OcgMessageSelectCard } from "@n1xx1/ocgcore-wasm";
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
    expect(question.selects[0].code).toBe(123);
  });

  it("rend tel quel ce qui n'a rien à cacher, sans copie, et ne copie que la carte masquée", () => {
    const shown = card(1, OcgLocation.MZONE, OcgPosition.FACEUP_ATTACK);
    const question: OcgMessageSelectCard = { type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, min: 1, max: 1, selects: [shown] };
    expect(hideCards(question, 0)).toBe(question);
    const hiddenSelects = [shown, card(1, OcgLocation.SZONE, OcgPosition.FACEDOWN_DEFENSE)];
    const hidden = hideCards({ ...question, selects: hiddenSelects }, 0);
    expect(hidden.selects[0]).toBe(shown);
    expect(hidden.selects[1]).toEqual({ ...hiddenSelects[1], code: 0 });
    expect(hiddenSelects[1].code).toBe(123);
  });

  it("cache une carte qui part dans la main adverse, montre le cimetière", () => {
    const toHand = { controller: 1, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE } as const;
    const toGrave = { ...toHand, location: OcgLocation.GRAVE, position: OcgPosition.FACEUP_ATTACK } as const;
    const move = (to: typeof toHand | typeof toGrave): OcgMessage => ({ type: OcgMessageType.MOVE, card: 123, from: toHand, to });
    expect(visibleTo(move(toHand), 0)).toMatchObject({ card: 0 });
    expect(visibleTo(move(toHand), 1)).toMatchObject({ card: 123 });
    expect(visibleTo(move(toGrave), 0)).toMatchObject({ card: 123 });
  });

  it("ne donne les nouvelles places d'un mélange de cartes posées qu'à leur contrôleur", () => {
    const place = (controller: 0 | 1, sequence: number) => ({ controller, location: OcgLocation.MZONE, sequence, position: OcgPosition.FACEDOWN_DEFENSE });
    const shuffle: OcgMessage = {
      type: OcgMessageType.SHUFFLE_SET_CARD,
      location: OcgLocation.MZONE,
      cards: [
        { from: place(0, 0), to: place(0, 2) },
        { from: place(1, 1), to: place(1, 0) },
      ],
    };
    expect(visibleTo(shuffle, 0)).toEqual({ ...shuffle, cards: [shuffle.cards[0], { from: place(1, 1), to: place(1, 1) }] });
    expect(visibleTo(shuffle, 1)).toEqual({ ...shuffle, cards: [{ from: place(0, 0), to: place(0, 0) }, shuffle.cards[1]] });
  });

  it("aiguille les HINT comme EDOPro : RACE au camp adverse, EFFECT au camp qui agit, CARD aux deux", () => {
    const hint = (hint_type: number): OcgMessage => ({ type: OcgMessageType.HINT, hint_type, player: 0, hint: 1n }) as OcgMessage;
    expect(visibleTo(hint(OcgHintType.RACE), 0)).toBeNull();
    expect(visibleTo(hint(OcgHintType.RACE), 1)).toMatchObject({ player: 0 });
    expect(visibleTo(hint(OcgHintType.EFFECT), 0)).toMatchObject({ player: 0 });
    expect(visibleTo(hint(OcgHintType.EFFECT), 1)).toBeNull();
    expect(visibleTo(hint(OcgHintType.CARD), 0)).toMatchObject({ player: 0 });
    expect(visibleTo(hint(OcgHintType.CARD), 1)).toMatchObject({ player: 0 });
  });
});
