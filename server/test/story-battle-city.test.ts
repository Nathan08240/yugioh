import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { SLIFER_ANIME, YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { isUnlocked, STORY, storyDeck, storyRules, validateStory } from "../src/story.ts";

const arc = STORY.arcs.find(({ id }) => id === "battle-city");
const duels = arc?.duels ?? [];

describe("arc Battle City", () => {
  it("suit le Royaume des Duellistes, de 5 à 8 duels à 4000 LP avec la règle battle-city", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(duels.length).toBeGreaterThanOrEqual(5);
    expect(duels.length).toBeLessThanOrEqual(8);
    expect(duels[0].requires).toEqual(["duelist-kingdom"]);
    for (const duel of duels) {
      expect(duel.id.startsWith("bc-")).toBe(true);
      expect(duel.rules).toEqual({ lp: 4000, hand: 5, special: ["battle-city"] });
    }
  });

  it("ne se déverrouille qu'une fois le Royaume des Duellistes terminé", () => {
    const kingdom = STORY.arcs[0].duels.map(({ id }) => id);
    expect(isUnlocked(duels[0], new Set(kingdom.slice(0, -1)))).toBe(false);
    expect(isUnlocked(duels[0], new Set(kingdom))).toBe(true);
  });

  it("offre Slifer version anime par le duel contre Strings, et par lui seul", () => {
    const givers = STORY.arcs.flatMap((other) => other.duels).filter((duel) => duel.rewards.cards?.includes(SLIFER_ANIME));
    expect(givers.map(({ id }) => id)).toEqual(["bc-strings"]);
    expect(givers[0].opponent).toBe("Strings");
  });

  it("chaque duel va au bout bot contre bot, sans erreur, avec la règle battle-city chargée", { timeout: 240_000 }, async () => {
    for (const duel of duels) {
      const rules = storyRules(duel);
      const deck = storyDeck(duel);
      for (let seed = 1n; seed <= 3n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + rules.cards.length, deck.length], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, deck], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
        expect(state.scripts).toContain("c511004014.lua");
      }
    }
  });
});
