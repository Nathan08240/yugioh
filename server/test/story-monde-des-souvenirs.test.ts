import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules, validateStory } from "../src/story.ts";

const arc = STORY.arcs.find((candidate) => candidate.id === "monde-des-souvenirs");
// "Diabound Kernel", Bakura's monster of the arc, unofficial and outside the pool.
const DIABOUND = 511000118;

describe("arc du Monde des souvenirs", () => {
  it("est valide et s'enchaîne après le Grand Championnat, jusqu'au duel final", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(arc?.duels.map((duel) => duel.id)).toEqual(["mds-voleur", "mds-seto", "mds-aknadin", "mds-zorc", "mds-yugi"]);
    expect(arc?.duels[0].requires).toEqual(["grand-championship"]);
    expect(arc?.duels.every((duel) => duel.rules.lp === 4000)).toBe(true);
    expect(STORY.anime).toContain(DIABOUND);
  });

  it("chaque duel va au bout bot contre bot sur quelques seeds, sans erreur", { timeout: 300_000 }, async () => {
    for (const duel of arc?.duels ?? []) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 3n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + 1, 40], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
        if (duel.deck.some(([code]) => code === DIABOUND)) expect(state.scripts).toContain(`c${DIABOUND}.lua`);
      }
    }
  });
});
