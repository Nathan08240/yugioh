import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { OBELISK_ANIME, RA_ANIME, SLIFER_ANIME, YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules, validateStory, type Arc } from "../src/story.ts";

const doma = STORY.arcs.find((arc) => arc.id === "doma") as Arc;
const GODS = new Set([OBELISK_ANIME, SLIFER_ANIME, RA_ANIME]);

describe("arc de Doma", () => {
  it("compte 5 à 8 duels à 4000 LP, enchaînés à la suite des finales de Battle City, sans Dieu Égyptien en récompense", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(doma.duels.length).toBeGreaterThanOrEqual(5);
    expect(doma.duels.length).toBeLessThanOrEqual(8);
    expect(doma.duels.every((duel) => duel.id.startsWith("doma-") && duel.rules.lp === 4000)).toBe(true);
    expect(doma.duels.map((duel) => duel.requires)).toEqual(doma.duels.map((_, i) => (i === 0 ? ["battle-city-finales"] : [doma.duels[i - 1].id])));
    expect(doma.duels.flatMap((duel) => duel.rewards.cards ?? []).filter((code) => GODS.has(code))).toEqual([]);
  });

  it("chaque duel va au bout bot contre bot sans erreur du moteur, les cartes d'Orichalque jouées", { timeout: 180_000 }, async () => {
    const played: string[] = [];
    for (const duel of doma.duels) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 10n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length, 40], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
        played.push(...state.log);
      }
    }
    for (const name of ["The Seal of Orichalcos", "Orichalcos Kyutora", "Orichalcos Shunoros"]) expect(played.some((line) => line.includes(name)), name).toBe(true);
  });
});
