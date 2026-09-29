import { expect, it } from "vitest";
import { isDone, revealAll, revealOrder, settle, startReveal, touch } from "./boosterReveal.ts";

it("range les cartes de la moins rare à la plus rare, sans mélanger une même rareté", () => {
  const pack = [
    { code: 1, rarity: "secret" },
    { code: 2, rarity: "common" },
    { code: 3, rarity: "rare" },
    { code: 4, rarity: "shortprint" },
    { code: 5, rarity: "common" },
    { code: 6, rarity: "ultimate" },
    { code: 7, rarity: "super" },
    { code: 8, rarity: "ultra" },
  ];
  expect(revealOrder(pack).map((card) => card.code)).toEqual([2, 5, 4, 3, 7, 8, 6, 1]);
  expect(pack[0].code).toBe(1);
});

it("révèle une carte par toucher, une fois le paquet ouvert", () => {
  let state = startReveal(2);
  expect(state).toEqual({ total: 2, revealed: 0, playing: true });

  state = touch(settle(state, 0));
  expect(state).toEqual({ total: 2, revealed: 1, playing: true });

  state = touch(settle(state, 1));
  expect(state.revealed).toBe(2);
  expect(isDone(state)).toBe(false);
  state = settle(state, 2);
  expect(isDone(state)).toBe(true);
  expect(touch(state)).toEqual(state);
});

it("un toucher pendant l'animation la passe sans révéler la carte suivante", () => {
  let state = touch(settle(startReveal(3), 0));
  state = touch(state);
  expect(state).toEqual({ total: 3, revealed: 1, playing: false });
  // The skipped animation ends after the next card started: it must not stop the new one.
  state = touch(state);
  expect(settle(state, 1)).toEqual(state);
});

it("tout révéler vide la pile, même pendant l'ouverture du paquet", () => {
  const state = revealAll(startReveal(9));
  expect(state).toEqual({ total: 9, revealed: 9, playing: false });
  expect(isDone(state)).toBe(true);
});
