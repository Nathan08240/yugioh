import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PUZZLE_FAILED, type PuzzleView } from "../../server/src/protocol.ts";
import { newBoard, playAll } from "./board.ts";
import { DuelView } from "./cards.ts";
import { Fin } from "./Fin.tsx";
import { initialLobby, reduce } from "./lobby.ts";
import { Puzzles } from "./Puzzles.tsx";

const ended = (winner: number, reason: number) => playAll(newBoard([4000, 2500], [0, 0]), [{ type: OcgMessageType.NEW_TURN, player: 0 }, { type: OcgMessageType.WIN, player: winner, reason }]);
const fin = (winner: number, reason: number, booster?: boolean) =>
  renderToStaticMarkup(
    <DuelView value={{ cards: new Map(), show: () => {}, seat: 0 }}>
      <Fin board={ended(winner, reason)} seat={0} room="r" vsBot opponent="Bot" puzzle={{ title: "Le coup de grâce", booster }} leave={() => {}} go={() => {}} onRematch={() => {}} />
    </DuelView>,
  );

it("un puzzle échoué propose de réessayer et dit pourquoi, sans parler de deck", () => {
  const html = fin(1, PUZZLE_FAILED);
  for (const text of ["Puzzle · Le coup de grâce", "Puzzle échoué", "Réessayer", "Votre tour s&#x27;est terminé", "Retour aux puzzles"]) expect(html).toContain(text);
  expect(html).not.toContain("Modifier mon deck");
});

it("un puzzle réussi montre son booster la première fois, puis la récompense déjà obtenue", () => {
  expect(fin(0, 1, true)).toContain("Ouvrir mes boosters");
  const again = fin(0, 1, false);
  expect(again).toContain("Puzzle réussi");
  expect(again).toContain("Puzzle déjà réussi");
  expect(again).not.toContain("Ouvrir mes boosters");
});

it("liste les puzzles avec leur statut et garde la dernière réussite jusqu'au duel suivant", () => {
  const puzzles: PuzzleView[] = [
    { id: "a", title: "Premier", goal: "Consigne A", done: true },
    { id: "b", title: "Second", goal: "Consigne B", done: false },
  ];
  const html = renderToStaticMarkup(<Puzzles puzzles={puzzles} send={() => {}} />);
  for (const text of ["Premier", "Consigne A", "Réussi", "Rejouer", "Second", "Jouer", "1 booster"]) expect(html).toContain(text);

  const state = reduce(reduce(initialLobby, { type: "puzzles", puzzles }), { type: "puzzle_won", id: "b", booster: true });
  expect(state.solved).toEqual({ type: "puzzle_won", id: "b", booster: true });
  expect(reduce(state, { type: "left" }).solved).toBeUndefined();
});
