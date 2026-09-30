import { describe, expect, it } from "vitest";
import { BOOSTERS } from "../src/boosters.ts";
import { cardInfo } from "../src/cards.ts";
import { botPick, DRAFTERS, openPacks, pickCard, validDraftMessage, type Draft } from "../src/draft.ts";
import type { Printing } from "../src/pool.ts";
import { cardScore, SEALED_PACKS } from "../src/sealed.ts";

const set = BOOSTERS.get("LOB");
if (!set) throw new Error("LOB absent");
// Boosters whose cards say where they come from: round * 100 + seat * 10 + slot, rarity "r<round> s<seat>".
const packsOf = (round: number) => Array.from({ length: DRAFTERS }, (_, seat) => set.cards.slice(0, 9).map((card, slot) => ({ code: card.code, rarity: `${round * 100 + seat * 10 + slot}` })));
const fresh = (): Draft => ({ round: 1, packs: packsOf(1), picks: Array.from({ length: DRAFTERS }, () => []) });
const origin = (card: Printing) => Math.floor(Number(card.rarity) / 10) % 10;

describe("mode Draft", () => {
  it("passe les boosters à gauche aux rondes impaires, à droite aux rondes paires", () => {
    const after = pickCard(fresh(), 0, () => packsOf(2)) as Draft;
    expect(after.packs.map((pack) => pack.length)).toEqual([8, 8, 8, 8]);
    expect(after.packs.map((pack) => origin(pack[0]))).toEqual([3, 0, 1, 2]);
    expect(after.picks[0][0].rarity).toBe("100");

    let draft = fresh();
    for (let i = 0; i < 9; i++) draft = pickCard(draft, 0, () => packsOf(2)) as Draft;
    expect(draft.round).toBe(2);
    const second = pickCard(draft, 0, () => packsOf(3)) as Draft;
    expect(second.packs.map((pack) => origin(pack[0]))).toEqual([1, 2, 3, 0]);
  });

  it("finit avec 54 cartes pour chacun après 6 rondes, chaque carte gardée une seule fois", () => {
    let draft = fresh();
    for (let pick = 0; pick < SEALED_PACKS * 9; pick++) draft = pickCard(draft, draft.packs[0].length - 1, () => packsOf(draft.round + 1)) as Draft;
    expect(draft.round).toBe(SEALED_PACKS);
    expect(draft.packs.every((pack) => pack.length === 0)).toBe(true);
    expect(draft.picks.map((cards) => cards.length)).toEqual([54, 54, 54, 54]);
    const all = draft.picks.flat().map((card) => card.rarity);
    expect(new Set(all).size).toBe(all.length);
  });

  it("refuse une carte hors du booster", () => {
    for (const index of [-1, 9, 1.5]) expect(pickCard(fresh(), index, () => packsOf(2))).toBeUndefined();
    expect(validDraftMessage({ type: "draft_pick", index: "1" })).toBe(false);
    expect(validDraftMessage({ type: "draft_pick", index: 3 })).toBe(true);
  });

  it("fait garder aux bots la carte de meilleure valeur", () => {
    for (const pack of openPacks(set)) {
      const best = cardScore(cardInfo(pack[botPick(pack)].code) ?? { type: 0, atk: 0, level: 0 });
      expect(pack.every(({ code }) => cardScore(cardInfo(code) ?? { type: 0, atk: 0, level: 0 }) <= best)).toBe(true);
    }
  });
});
