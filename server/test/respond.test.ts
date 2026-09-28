import { OcgLocation, OcgMessageType, OcgRace, type OcgMessage, type OcgMessageSelectSum } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { respond } from "../src/respond.ts";

const card = (amount: number) => ({ code: 1, controller: 0 as const, location: OcgLocation.MZONE, sequence: 0, amount });

describe("répondeur première option", () => {
  it("choisit la plus petite sélection qui atteint la somme, exacte d'abord", () => {
    const sum = (amount: number, amounts: number[]): OcgMessageSelectSum => ({ type: OcgMessageType.SELECT_SUM, player: 0, select_max: 0, amount, min: 1, max: 3, selects_must: [], selects: amounts.map(card) });
    expect(respond(sum(8, [4, 3, 5]))).toMatchObject({ indicies: [1, 2] });
    // Level 1 or 6 (two levels in one amount): 6 hits 6 exactly.
    expect(respond(sum(6, [4, (6 << 16) | 1]))).toMatchObject({ indicies: [1] });
    expect(respond(sum(7, [4, 5]))).toMatchObject({ indicies: [0, 1] });
    // Ritual tributes, as the engine sends them: "equal or more", no count limit.
    expect(respond({ ...sum(8, [4, 5]), select_max: 1, min: 0, max: 0 })).toMatchObject({ indicies: [0, 1] });
  });

  it("répartit les compteurs et déclare le premier type proposé", () => {
    const counters: OcgMessage = { type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 3, cards: [{ ...card(0), count: 2 }, { ...card(0), count: 2 }] };
    expect(respond(counters)).toMatchObject({ counters: [2, 1] });
    const race: OcgMessage = { type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 1, available: (OcgRace.DRAGON | OcgRace.WARRIOR) as OcgRace };
    expect(respond(race)).toMatchObject({ races: [OcgRace.WARRIOR] });
  });
});
