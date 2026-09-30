import { expect, it } from "vitest";
import { initialLobby, reduce, type Wonder } from "./lobby.ts";
import { faceDownOrder, SHUFFLE_ROUNDS, slideOffsets } from "./pioche.ts";

it("reprend les cartes dans l'ordre face cachée fixé par le serveur", () => {
  expect(faceDownOrder(["a", "b", "c", "d", "e"], [3, 0, 4, 1, 2])).toEqual(["d", "a", "e", "b", "c"]);
});

it("mélange face cachée sans rien superposer, et remet chaque carte à sa place au dernier tour", () => {
  for (const round of SHUFFLE_ROUNDS) expect(round.toSorted()).toEqual([0, 1, 2, 3, 4]);
  expect(slideOffsets(5, 0)).toEqual([2, 3, -2, 0, -3]);
  expect(slideOffsets(5, SHUFFLE_ROUNDS.length - 1)).toEqual([0, 0, 0, 0, 0]);
  expect(slideOffsets(5, -1)).toEqual([0, 0, 0, 0, 0]);
});

it("garde l'état de la pioche miracle reçu du serveur", () => {
  const drawn: Wonder = { type: "wonder", status: "drawn", cards: [{ code: 1, rarity: "common" }] };
  expect(reduce(initialLobby, drawn).wonder).toEqual(drawn);
});
