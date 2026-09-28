import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, vi } from "vitest";
import { Bot } from "../src/bot.ts";
import { openDuel, runDuel, STANDARD_RULES, type Player, type Seed } from "../src/duel.ts";
import { respond } from "../src/respond.ts";

const POLYMERIZATION = 24094653;
const FLAME_MANIPULATOR = 34460851;
const MASAKI = 44287299;
const FLAME_SWORDSMAN = 45231177;

// Every hand holds Polymerization and both materials of Flame Swordsman, so the fusion happens whatever the shuffle.
const deck = [...Array<number>(14).fill(POLYMERIZATION), ...Array<number>(13).fill(FLAME_MANIPULATOR), ...Array<number>(13).fill(MASAKI)];
const seed: Seed = [1n, 2n, 3n, 4n];

function bot(seat: 0 | 1, extra: number): Player {
  const player = new Bot(seat, STANDARD_RULES.lp, [40, 40], 0, [extra, extra]);
  return (question, log) => player.answer(question, log);
}

describe("extra deck dans le duel", () => {
  it("charge l'extra deck de chaque joueur à l'emplacement EXTRA du moteur", async () => {
    const { lib, handle } = await openDuel(seed, [deck, deck], vi.fn(), undefined, STANDARD_RULES, [[FLAME_SWORDSMAN, FLAME_SWORDSMAN], [FLAME_SWORDSMAN]]);
    expect([0, 1].map((team) => lib.duelQueryCount(handle, team, OcgLocation.EXTRA))).toEqual([2, 1]);
    expect([0, 1].map((team) => lib.duelQueryCount(handle, team, OcgLocation.DECK))).toEqual([40, 40]);
    lib.destroyDuel(handle);
  });

  it("sans extra deck, le moteur n'en voit aucun", async () => {
    const { lib, handle } = await openDuel(seed, [deck, deck], vi.fn());
    expect([0, 1].map((team) => lib.duelQueryCount(handle, team, OcgLocation.EXTRA))).toEqual([0, 0]);
    lib.destroyDuel(handle);
  });

  it("invoque par fusion avec Polymérisation sur une seed fixe, le bot y compris", async () => {
    const play = () => runDuel(seed, 2, [bot(0, 1), bot(1, 1)], [deck, deck], STANDARD_RULES, [[FLAME_SWORDSMAN], [FLAME_SWORDSMAN]]);
    const state = await play();

    expect(state.errors).toEqual([]);
    expect(state.log).toContain("J1 active Polymerization");
    expect(state.log).toContain("J1 invoque spécialement Flame Swordsman");
    expect((await play()).log).toEqual(state.log);
  });

  it("un répondeur qui prend toujours la première option joue avec un extra deck sans erreur moteur", async () => {
    const first: Player = (question) => respond(question);
    const state = await runDuel(seed, 4, [first, first], [deck, deck], STANDARD_RULES, [[FLAME_SWORDSMAN], [FLAME_SWORDSMAN]]);
    expect(state.errors).toEqual([]);
  });
});
