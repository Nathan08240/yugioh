import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { announceCard } from "../src/announce.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { respond } from "../src/respond.ts";

const NEEDLE_WALL = 38299233;

it("le moteur lance le dé de Needle Wall à la Standby Phase de son contrôleur, et les deux joueurs le reçoivent", async () => {
  const seen: (readonly OcgMessage[])[] = [[], []];
  const player = (seat: number): Player => (question, log) => {
    seen[seat] = log;
    return respond(question, announceCard);
  };
  const field = [{ code: NEEDLE_WALL, controller: 0 as const, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }];
  const state = await runDuel([1n, 2n, 3n, 4n], 2, [player(0), player(1)], [YUGI, KAIBA], undefined, [], field);
  expect(state.errors).toEqual([]);
  for (const log of seen) {
    const dice = log.filter((msg) => msg.type === OcgMessageType.TOSS_DICE);
    expect(dice.length).toBeGreaterThan(0);
    expect(dice[0]).toMatchObject({ player: 0 });
    expect(dice[0].results.every((face) => face >= 1 && face <= 6)).toBe(true);
  }
});
