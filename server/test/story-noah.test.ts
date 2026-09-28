import { OcgMessageType, OcgResponseType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { agreeToRules, runDuel, type Player } from "../src/duel.ts";
import { STORY, storyDeck, storyRules } from "../src/story.ts";

const noah = STORY.arcs.find((arc) => arc.id === "noah");
// Deck Masters declared from outside the duel: location 0.
const declaresDeckMaster = (question: OcgMessage) => question.type === OcgMessageType.SELECT_CARD && question.selects.length > 1 && question.selects.every((card) => !card.location);

describe("arc du Monde virtuel de Noah", () => {
  it("suit l'arc de Battle City, les Big Five puis Noah", () => {
    expect(noah?.duels.map((duel) => duel.id)).toEqual(["noah-gansley", "noah-crump", "noah-johnson", "noah-nesbitt", "noah-leichter", "noah-noah"]);
    expect(noah?.duels[0].requires).toEqual(["battle-city"]);
  });

  it("impose le système des Deck Masters sans le demander au joueur", () => {
    const question: OcgMessage = { type: OcgMessageType.SELECT_YESNO, player: 0, description: 153999999n << 20n };
    expect(agreeToRules(question)).toEqual({ type: OcgResponseType.SELECT_YESNO, yes: true });
  });

  it("chaque duel va au bout bot contre bot avec le système des Deck Masters", { timeout: 180_000 }, async () => {
    for (const duel of noah?.duels ?? []) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 3n; seed++) {
        const declared = [false, false];
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + 1, 40], 0));
        const players = bots.map((bot, seat): Player => (question, log) => {
          declared[seat] ||= declaresDeckMaster(question);
          return bot.answer(question, log);
        });
        const state = await runDuel([seed, 2n, 3n, 4n], 500, players, [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors).toEqual([]);
        expect(declared, `${duel.id} seed ${seed}`).toEqual([true, true]);
      }
    }
  });
});
