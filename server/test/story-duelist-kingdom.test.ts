import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules } from "../src/story.ts";

// Reason of the WIN message the Duelist Kingdom rule card sends to a player who ended a turn with no monster and no summon.
const NO_SUMMON_LOSS = 0x5a;
const SEEDS = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
const arc = STORY.arcs.find((candidate) => candidate.id === "duelist-kingdom");

describe("arc du Royaume des Duellistes", () => {
  it("compte 5 à 8 duels, tous aux règles de l'île sur 2000 LP", () => {
    expect(arc?.duels.length).toBeGreaterThanOrEqual(5);
    expect(arc?.duels.length).toBeLessThanOrEqual(8);
    for (const duel of arc?.duels ?? []) expect(duel.rules).toMatchObject({ lp: 2000, special: ["duelist-kingdom"] });
  });

  // Turn of the last idle question of each seat that offered a monster to summon or set.
  const offeredAt: [number, number] = [0, 0];

  function bot(seat: 0 | 1, lp: number, decks: number[]): Player {
    const player = new Bot(seat, lp, decks, 0);
    return (question, log) => {
      if (question.type === OcgMessageType.SELECT_IDLECMD && question.summons.length + question.monster_sets.length > 0) {
        offeredAt[seat] = log.filter((msg) => msg.type === OcgMessageType.NEW_TURN).length;
      }
      return player.answer(question, log);
    };
  }

  it.each(arc?.duels.map((duel) => [duel.id, duel] as const) ?? [])(
    "%s va au bout bot contre bot sans erreur, et le bot ne perd jamais sur la règle en ayant un monstre à poser",
    { timeout: 120_000 },
    async (_id, duel) => {
      const rules = storyRules(duel);
      const sizes = [YUGI.length + 1, storyDeck(duel).length];
      for (const seed of SEEDS) {
        offeredAt.fill(0);
        const players = [bot(0, rules.lp, sizes), bot(1, rules.lp, sizes)];
        const state = await runDuel([seed, 2n, 3n, 4n], 500, players, [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors).toEqual([]);
        expect(state.scripts).toContain("c511002621.lua");
        if (state.reason === NO_SUMMON_LOSS) {
          const loser = 1 - (state.winner as number);
          expect(offeredAt[loser], `${duel.id} seed ${seed}: J${loser + 1} avait un monstre à poser au tour ${state.turns}`).not.toBe(state.turns);
        }
      }
    },
  );
});
