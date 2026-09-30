import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { expect, it, vi } from "vitest";
import { initialLobby, inviteLink, minutes, reduce, roomFromUrl, type Action } from "./lobby.ts";

it("passe du pseudo à l'attente puis au plateau quand le duel démarre", () => {
  let state = reduce(initialLobby, { type: "profile", pseudo: null, needsStarter: false });
  state = reduce(state, { type: "error", error: "pseudo déjà pris" });
  state = reduce(state, { type: "profile", pseudo: "Yugi", needsStarter: false });
  state = reduce(state, { type: "joined", room: "ABCDE", seat: 0, lp: 4000, decks: [40, 40], extras: [0, 0], log: [] });
  expect(state).toMatchObject({ pseudo: "Yugi", room: "ABCDE", seat: 0, started: false, error: undefined, closed: false });

  state = reduce(state, { type: "messages", messages: [{ type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 1, position: 10 }] }] });
  expect(state.started).toBe(true);
  expect(state.board?.players[0]).toMatchObject({ deck: 39, hand: [{ code: 1, position: 10 }] });
  // The duel screen animates each batch of messages, the board is already up to date.
  expect(state).toMatchObject({ lp: 4000, feed: { id: 1, messages: [{ type: OcgMessageType.DRAW }] } });
  expect(reduce(state, { type: "messages", messages: [] }).feed?.id).toBe(2);

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

it("garde le mode Histoire ouvert pendant ses duels et oublie la conclusion en quittant le duel", () => {
  let state = reduce(reduce(initialLobby, { type: "story_menu", open: true }), { type: "story", arcs: [] });
  state = reduce(state, { type: "joined", room: "ABCDE", seat: 0, lp: 2000, decks: [41, 40], extras: [0, 0], log: [] });
  const won = { type: "story_won", duel: "dk-weevil", outro: "Fin.", rewards: null } as const;
  state = reduce(state, won);
  expect(state).toMatchObject({ storyOpen: true, story: [], won });
  expect(reduce(state, { type: "left" })).toMatchObject({ storyOpen: true, room: undefined, won: undefined });
});

it("donne à chaque joueur ses LP de départ et ceux de l'adversaire, par place", () => {
  const joined = { type: "joined" as const, room: "ABCDE", decks: [40, 40] as [number, number], extras: [0, 0] as [number, number], log: [] };
  const first = reduce(initialLobby, { ...joined, seat: 0, lp: 4000, opponentLp: 2000 });
  expect(first.board?.players.map((side) => side.lp)).toEqual([4000, 2000]);
  expect(first).toMatchObject({ lp: 4000, opponentLp: 2000 });
  const second = reduce(initialLobby, { ...joined, seat: 1, lp: 2000, opponentLp: 4000 });
  expect(second.board?.players.map((side) => side.lp)).toEqual([4000, 2000]);
  expect(reduce(initialLobby, { ...joined, seat: 0, lp: 2000 }).board?.players.map((side) => side.lp)).toEqual([2000, 2000]);
});

it("extrait le code de salle d'un lien d'invitation", () => {
  expect(roomFromUrl("https://site.fr/?salle=abcd2")).toBe("ABCD2");
  expect(roomFromUrl("https://site.fr/?salle=ABCD")).toBeUndefined();
  expect(roomFromUrl("https://site.fr/?salle=ABCD0")).toBeUndefined();
  expect(roomFromUrl("https://site.fr/")).toBeUndefined();
  expect(roomFromUrl(inviteLink("https://site.fr", "K7M2P"))).toBe("K7M2P");
});

it("suit les délais d'un duel en ligne jusqu'à leur arrêt ou la fin du duel", () => {
  vi.useFakeTimers({ now: 1000 });
  let state = reduce(initialLobby, { type: "timer", kind: "answer", seat: 1, ms: 120_000 });
  state = reduce(state, { type: "timer", kind: "reconnect", seat: 1, ms: 60_000 });
  expect(state).toMatchObject({ answerBy: { seat: 1, until: 121_000 }, away: { seat: 1, until: 61_000 } });
  expect(reduce(state, { type: "timer", kind: "answer", seat: 1, ms: null }).answerBy).toBeUndefined();
  expect(reduce(state, { type: "left" })).toMatchObject({ answerBy: undefined, away: undefined });
  expect([minutes(121_000, 1000), minutes(66_500, 1000), minutes(0, 1000)]).toEqual(["2:00", "1:06", "0:00"]);
  vi.useRealTimers();
});

it("garde le droit admin annoncé par le profil", () => {
  expect(reduce(initialLobby, { type: "profile", pseudo: "nathan", needsStarter: false, admin: true }).admin).toBe(true);
  expect(reduce(initialLobby, { type: "profile", pseudo: "dave", needsStarter: false }).admin).toBeUndefined();
});

it("suit la revanche en ligne jusqu'au nouveau duel, qui l'efface avec la conclusion de l'histoire", () => {
  const joined: Extract<Action, { type: "joined" }> = { type: "joined", room: "ABCDE", seat: 0, lp: 4000, decks: [40, 40], extras: [0, 0], log: [] };
  let state = reduce(reduce(initialLobby, joined), { type: "story_won", duel: "d", outro: "Fin.", rewards: null });
  state = reduce(state, { type: "rematch", from: 1 });
  expect(state.rematch).toEqual({ from: 1 });
  expect(reduce(state, { type: "rematch_declined" }).rematch).toBe("declined");
  // A reconnection replays the finished duel: it keeps both.
  const replay = reduce(state, { ...joined, log: [{ type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 1, position: 10 }] }] });
  expect(replay).toMatchObject({ rematch: { from: 1 }, won: { duel: "d" } });
  expect(reduce(state, joined)).toMatchObject({ rematch: undefined, won: undefined });
});
