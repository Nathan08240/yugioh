import { OcgLocation, OcgMessageType, OcgPosition, OcgProcessResult, OcgResponseType, SelectIdleCMDAction, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { applyAll, newBoard, type Message } from "../../client/src/board.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { fieldMonsters, fieldMoves, fieldStats, openDuel, STARTING_LP, type Placed } from "../src/duel.ts";
import type { DuelEvent } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { visibleTo } from "../src/visibility.ts";
import { playAudit } from "../scripts/audit-cartes.ts";

const WANDERING_MUMMY = 42994702;
const BATTLE_OX = 5053103;
const DARK_MAGICIAN = 46986414;
const KURIBOH = 40640057;

const place = (code: number, sequence: number, position: OcgPosition): Placed => ({ code, controller: 0, location: OcgLocation.MZONE, sequence, position });
const FIELD = [
  place(WANDERING_MUMMY, 0, OcgPosition.FACEUP_ATTACK),
  place(BATTLE_OX, 1, OcgPosition.FACEDOWN_DEFENSE),
  place(DARK_MAGICIAN, 2, OcgPosition.FACEDOWN_DEFENSE),
  place(KURIBOH, 3, OcgPosition.FACEDOWN_DEFENSE),
];

describe("mélange des cartes posées (Momie Errante)", () => {
  it("rend le message du moteur, puis les nouvelles places au seul propriétaire, plateau du client identique au moteur", async () => {
    const duel = await openDuel([1n, 2n, 3n, 4n], [YUGI, KAIBA], () => {}, undefined, undefined, [], FIELD);
    const { lib, handle } = duel;
    const seen: OcgMessage[] = [];
    const codes = () => fieldMonsters(duel)[0].slice(0, 4).map((card) => card?.code);
    const before = codes();
    for (let step = 0; step < 100 && !seen.some((msg) => msg.type === OcgMessageType.SHUFFLE_SET_CARD); step++) {
      const status = lib.duelProcess(handle);
      const messages = lib.duelGetMessage(handle);
      seen.push(...messages);
      const question = messages.at(-1);
      if (status !== OcgProcessResult.WAITING || !question) continue;
      const mummy = question.type === OcgMessageType.SELECT_IDLECMD ? question.activates.findIndex((card) => card.code === WANDERING_MUMMY) : -1;
      lib.duelSetResponse(handle, mummy === -1 ? respond(question) : { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: mummy });
    }
    const shuffle = seen.find((msg) => msg.type === OcgMessageType.SHUFFLE_SET_CARD);
    expect(shuffle).toMatchObject({ location: OcgLocation.MZONE });
    expect(shuffle?.type === OcgMessageType.SHUFFLE_SET_CARD && shuffle.cards.map((card) => card.from.sequence)).toEqual([0, 1, 2, 3]);
    const after = codes();
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());

    const board = (seat: number) => {
      const events: DuelEvent[] = [...fieldMoves(FIELD), ...seen].flatMap((msg) => visibleTo(msg, seat) ?? []);
      const shown = newBoard(STARTING_LP, [YUGI.length, KAIBA.length]);
      applyAll(shown, [...events, fieldStats(duel, seat)] as unknown as Message[]);
      return shown;
    };
    expect(board(0).players[0].monsters.slice(0, 4).map((card) => card?.code)).toEqual(after);
    expect(board(1).players[0].monsters.slice(0, 4).map((card) => card?.code)).toEqual([0, 0, 0, 0]);
    const opponent = JSON.stringify([...fieldMoves(FIELD), ...seen].flatMap((msg) => visibleTo(msg, 1) ?? []), (_key, value) => (typeof value === "bigint" ? String(value) : value));
    expect(opponent).not.toContain(String(DARK_MAGICIAN));
    // Neither the opponent nor a spectator (seat -1, as in room.ts) gets the code of a face-down monster.
    for (const viewer of [1, -1]) expect(fieldStats(duel, viewer).monsters[0]).toEqual(Array(5).fill(null));
    lib.destroyDuel(handle);
  });

  it("dans un duel de bots construit autour d'elle, va au bout sans erreur, sans réponse refusée ni écart de plateau, sur plusieurs graines", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const played = await playAudit(WANDERING_MUMMY, seed);
      expect(played.findings, `graine ${seed}`).toEqual([]);
      expect(played.ended).toBe(true);
    }
  });
});
