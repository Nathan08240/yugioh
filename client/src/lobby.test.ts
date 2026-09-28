import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { initialLobby, reduce } from "./lobby.ts";

it("passe du pseudo à l'attente puis au plateau quand le duel démarre", () => {
  let state = reduce(initialLobby, { type: "profile", pseudo: null, needsStarter: false });
  state = reduce(state, { type: "error", error: "pseudo déjà pris" });
  state = reduce(state, { type: "profile", pseudo: "Yugi", needsStarter: false });
  state = reduce(state, { type: "joined", room: "ABCDE", seat: 0, lp: 4000, decks: [40, 40], log: [] });
  expect(state).toMatchObject({ pseudo: "Yugi", room: "ABCDE", seat: 0, started: false, error: undefined, closed: false });

  state = reduce(state, { type: "messages", messages: [{ type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 1, position: 10 }] }] });
  expect(state.started).toBe(true);
  expect(state.board?.players[0]).toMatchObject({ deck: 39, hand: [{ code: 1, position: 10 }] });

  // Each question gets a new id, answering clears it until the next one.
  const question = { type: OcgMessageType.SELECT_YESNO, player: 0, description: "0" } as const;
  state = reduce(reduce(state, { type: "question", question, retry: false }), { type: "question", question, retry: true });
  expect(state.question).toEqual({ question, retry: true, id: 2 });
  expect(reduce(state, { type: "answered" }).question).toBeUndefined();

  // A lost connection keeps the room so it can be joined again.
  state = reduce(reduce(state, { type: "closed" }), { type: "connecting" });
  expect(state).toMatchObject({ pseudo: undefined, room: "ABCDE", closed: false });
  expect(reduce(state, { type: "left" })).toMatchObject({ room: undefined, board: undefined, started: false });
});
