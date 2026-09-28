import { expect, it } from "vitest";
import { initialLobby, reduce } from "./lobby.ts";

it("passe du pseudo à l'attente puis au journal quand le duel démarre", () => {
  let state = reduce(initialLobby, { type: "profile", pseudo: null });
  state = reduce(state, { type: "error", error: "pseudo déjà pris" });
  state = reduce(state, { type: "profile", pseudo: "Yugi" });
  state = reduce(state, { type: "joined", room: "ABCDE", seat: 0, log: [] });
  expect(state).toEqual({ pseudo: "Yugi", room: "ABCDE", seat: 0, journal: [], error: undefined, closed: false });

  state = reduce(state, { type: "messages", messages: [{ type: 90, player: 0 }] as never });
  expect(state.journal).toEqual(['{"type":90,"player":0}']);

  // A lost connection keeps the room so it can be joined again.
  state = reduce(reduce(state, { type: "closed" }), { type: "connecting" });
  expect(state).toMatchObject({ pseudo: undefined, room: "ABCDE", closed: false });
});
