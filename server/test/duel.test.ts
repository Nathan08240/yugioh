import { describe, expect, it } from "vitest";
import { readCard } from "../src/cards.ts";
import { KAIBA, OBELISK_ANIME, SLIFER_ANIME, YUGI } from "../src/decks.ts";
import { runDuel } from "../src/duel.ts";

describe("duel ocgcore", () => {
  it("utilise deux decks de 40 cartes présentes dans la base", () => {
    expect(YUGI).toHaveLength(40);
    expect(KAIBA).toHaveLength(40);
    expect([...YUGI, ...KAIBA].filter((code) => !readCard(code))).toEqual([]);
  });

  it("joue un duel déterministe jusqu'à la victoire à 4000 LP", async () => {
    const state = await runDuel([1n, 2n, 3n, 4n], 10);

    expect(state.errors).toEqual([]);
    expect(state.turns).toBeGreaterThan(1);
    expect(state.scripts).toContain(`c${SLIFER_ANIME}.lua`);
    expect(state.scripts).toContain(`c${OBELISK_ANIME}.lua`);
    // The engine declares the winner exactly when the damage dealt reaches 4000.
    const remaining = state.log.flatMap((line) => /reste (-?\d+)/.exec(line)?.[1] ?? []).map(Number);
    expect(remaining.slice(0, -1).every((lp) => lp > 0)).toBe(true);
    expect(remaining.at(-1)).toBeLessThanOrEqual(0);
    expect(state.winner).not.toBeNull();
    expect((await runDuel([1n, 2n, 3n, 4n], 10)).log).toEqual(state.log);
  });

  it("invoque l'Obelisk anime sans erreur de script", async () => {
    const state = await runDuel([77n, 2n, 3n, 4n], 40);

    expect(state.errors).toEqual([]);
    expect(state.log).toContain("J2 invoque Obelisk the Tormentor (Anime)");
  });
});
