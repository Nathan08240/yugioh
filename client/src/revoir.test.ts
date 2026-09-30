import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import type { ServerMessage, Wire } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Message } from "./board.ts";
import recorded from "./fixtures/duel.json";
import { initialLobby, reduce, type ReplayView } from "./lobby.ts";
import { avancer, debut, tourSuivant } from "./Revoir.tsx";

const received = recorded.received as Wire<ServerMessage>[];
const batches = received.flatMap((msg) => (msg.type === "messages" ? [msg.messages as Message[]] : []));
const replay: ReplayView = { type: "replay", id: 1, seat: 0, lp: recorded.lp, decks: recorded.decks as [number, number], extras: [0, 0], opponent: "Bot", batches };
const starts = (index: number) => batches[index].some((msg) => msg.type === OcgMessageType.NEW_TURN);

it("lu lot par lot, le rejeu finit sur le plateau du duel entier", () => {
  let lecture = debut(replay);
  while (lecture.index < batches.length) lecture = avancer(lecture, batches, lecture.index + 1);
  expect(lecture.board).toEqual(playAll(newBoard(recorded.lp, replay.decks), batches.flat()));
  expect(lecture.feed?.id).toBe(batches.length);
  expect(lecture.scene).toBe(0);
});

it("« Tour suivant » saute au lot du prochain tour, d'un coup et sans animation", () => {
  const first = tourSuivant(batches, 0);
  expect(starts(first - 1)).toBe(true);
  const second = tourSuivant(batches, first);
  expect(second).toBeGreaterThan(first);
  expect(batches.slice(first, second - 1).some((batch) => batch.some((msg) => msg.type === OcgMessageType.NEW_TURN))).toBe(false);
  expect(tourSuivant(batches, batches.length)).toBe(batches.length);

  const played = avancer(debut(replay), batches, 1);
  const jumped = avancer(played, batches, second, true);
  expect(jumped).toMatchObject({ index: second, scene: 1, feed: played.feed });
  expect(jumped.board.turn).toBe(playAll(newBoard(recorded.lp, replay.decks), batches.slice(0, second).flat()).turn);
});

it("le rejeu reçu s'ouvre, se ferme et laisse la place à un duel qui commence", () => {
  const open = reduce(initialLobby, replay);
  expect(open.replay).toBe(replay);
  expect(reduce(open, { type: "replay_closed" }).replay).toBeUndefined();
  expect(reduce(open, { type: "joined", room: "ABCDE", seat: 0, lp: 4000, decks: [40, 40], extras: [0, 0], log: [] }).replay).toBeUndefined();
});
