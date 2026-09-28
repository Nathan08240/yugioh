import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { OBELISK_ANIME, RA_ANIME, SLIFER_ANIME, YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules, validateStory, type Arc } from "../src/story.ts";

const championship = STORY.arcs.find((arc) => arc.id === "grand-championship") as Arc;
const GODS = new Set([OBELISK_ANIME, SLIFER_ANIME, RA_ANIME]);

describe("arc du Grand Championship KC", () => {
  it("compte 4 à 6 duels à 4000 LP, enchaînés à la suite de l'arc de Doma, sans Dieu Égyptien en récompense", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(championship.duels.length).toBeGreaterThanOrEqual(4);
    expect(championship.duels.length).toBeLessThanOrEqual(6);
    expect(championship.duels.every((duel) => duel.id.startsWith("kcgc-") && duel.rules.lp === 4000)).toBe(true);
    expect(championship.duels.map((duel) => duel.requires)).toEqual(championship.duels.map((_, i) => (i === 0 ? ["doma"] : [championship.duels[i - 1].id])));
    expect(championship.duels.flatMap((duel) => duel.rewards.cards ?? []).filter((code) => GODS.has(code))).toEqual([]);
  });

  it("chaque duel va au bout bot contre bot sans erreur du moteur", { timeout: 180_000 }, async () => {
    for (const duel of championship.duels) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 10n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length, 40], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
      }
    }
  });
});
