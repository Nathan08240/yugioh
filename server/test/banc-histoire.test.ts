import { describe, expect, it } from "vitest";
import { entries, story, type Entry } from "../scripts/banc-histoire.ts";
import { STORY, STORY_REVENGES } from "../src/story.ts";

const all = entries();
const byId = (id: string) => all.find((entry) => entry.id === id) as Entry;

describe("banc d'essai de l'histoire", () => {
  it("liste chaque duel de l'histoire dans l'ordre, facultatifs compris, et la revanche de chaque arc après son dernier duel", () => {
    const expected = STORY.arcs.flatMap((arc) => [...arc.duels.map((duel) => duel.id), ...(arc.revenge ? [`${arc.revenge.boss}+revanche`] : [])]);
    expect(all.map((entry) => entry.id)).toEqual(expected);
    expect(all.filter((entry) => entry.revenge)).toHaveLength(STORY_REVENGES.size);
  });

  it("joue l'adversaire au niveau du serveur : Normal, Expert pour une revanche", () => {
    expect(all.filter((entry) => entry.revenge).every((entry) => entry.level === "expert")).toBe(true);
    expect(all.filter((entry) => !entry.revenge).every((entry) => entry.level === "normal")).toBe(true);
  });

  it("donne le deck imposé au joueur du parcours de Kaiba, un deck type aux autres duels", () => {
    expect(byId("kb-yugi").player.name).toContain("imposé");
    expect(byId("dk-weevil").player.name).toBe("Starter Yugi");
    expect(all.filter((entry) => !entry.duel.player && !entry.player.main.length)).toEqual([]);
  });

  it.each(["dk-weevil", "kb-yugi", "noah-gansley", "dk-pegasus+revanche"])("%s : joue 2 graines en normal et en facile, sans erreur et de façon reproductible", async (id) => {
    const entry = byId(id);
    for (const easy of [false, true]) {
      const tally = await story(entry, 2, easy);
      expect(tally.wins + tally.losses + tally.draws).toBe(2);
      expect(await story(entry, 2, easy)).toEqual(tally);
    }
  }, 60_000);
});
