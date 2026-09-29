import { OcgLocation, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { readCard } from "../src/cards.ts";
import { KAIBA, OBELISK_ANIME, SLIFER_ANIME, YUGI } from "../src/decks.ts";
import { fieldStats, openDuel, runDuel } from "../src/duel.ts";

const DARK_MAGICIAN = 46986414;
const YAMI = 59197169;
const BATTLE_OX = 5053103;

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

  it("donne l'ATK et la DEF courantes des monstres, sans celles d'un monstre face cachée adverse", async () => {
    const duel = await openDuel([1n, 2n, 3n, 4n], [YUGI, KAIBA], () => {});
    const add = (team: 0 | 1, code: number, location: OcgLocation, sequence: number, position: OcgPosition) =>
      duel.lib.duelNewCard(duel.handle, { team, duelist: 0, code, controller: team, location, sequence, position });
    add(0, DARK_MAGICIAN, OcgLocation.MZONE, 0, OcgPosition.FACEUP_ATTACK);
    add(0, YAMI, OcgLocation.SZONE, 5, OcgPosition.FACEUP_ATTACK);
    add(1, BATTLE_OX, OcgLocation.MZONE, 2, OcgPosition.FACEDOWN_DEFENSE);
    duel.lib.duelProcess(duel.handle);

    const empty = [null, null, null, null, null];
    // Yami gives Spellcasters 200 ATK and DEF.
    expect(fieldStats(duel, 0).monsters).toEqual([[{ atk: 2700, def: 2300 }, ...empty.slice(1)], empty]);
    expect(fieldStats(duel, 1).monsters[1]).toEqual([null, null, { atk: 1700, def: 1000 }, null, null]);
    duel.lib.destroyDuel(duel.handle);
  });

  it("invoque l'Obelisk anime sans erreur de script", async () => {
    const state = await runDuel([77n, 2n, 3n, 4n], 40);

    expect(state.errors).toEqual([]);
    expect(state.log).toContain("J2 invoque Obelisk the Tormentor (Anime)");
  });
});
