import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules, type StoryDuel } from "../src/story.ts";

const OBELISK_ANIME = 511600398;
const RA_ANIME = 511600400;
const arc = STORY.arcs.find((candidate) => candidate.id === "battle-city-finales");
const duels: StoryDuel[] = arc?.duels ?? [];

describe("arc des finales de Battle City", () => {
  it("compte 5 à 8 duels, le premier après l'arc de Noah, tous aux règles de Battle City à 4000 LP", () => {
    expect(duels.length).toBeGreaterThanOrEqual(5);
    expect(duels.length).toBeLessThanOrEqual(8);
    expect(duels.every((duel) => duel.id.startsWith("bcf-"))).toBe(true);
    expect(duels[0].requires).toEqual(["noah"]);
    for (const duel of duels) expect(duel.rules).toEqual({ lp: 4000, hand: 5, special: ["battle-city"] });
  });

  it("offre Obelisk avec le duel contre Kaiba et Râ avec le duel final contre Marik, qui jouent leur Dieu", () => {
    const kaiba = duels.find((duel) => duel.opponent === "Seto Kaiba") as StoryDuel;
    const marik = duels.at(-1) as StoryDuel;
    expect(marik.opponent).toBe("Marik");
    expect(kaiba.rewards.cards).toContain(OBELISK_ANIME);
    expect(marik.rewards.cards).toContain(RA_ANIME);
    expect(storyDeck(kaiba)).toContain(OBELISK_ANIME);
    expect(storyDeck(marik)).toContain(RA_ANIME);
  });

  it("chaque duel va au bout bot contre bot, sans erreur, aux règles de Battle City", { timeout: 300_000 }, async () => {
    for (const duel of duels) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 3n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + 1, 40], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
        expect(state.scripts).toContain("c511004014.lua");
      }
    }
  });
});
