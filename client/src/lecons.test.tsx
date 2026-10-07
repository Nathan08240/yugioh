import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LESSON_POINTS, PUZZLE_FAILED, type LessonView } from "../../server/src/protocol.ts";
import { newBoard, playAll } from "./board.ts";
import { DuelView } from "./cards.ts";
import { Fin } from "./Fin.tsx";
import { Lecons } from "./Lecons.tsx";
import { initialLobby, reduce } from "./lobby.ts";

const ended = (winner: number, reason: number) => playAll(newBoard([4000, 2500], [0, 0]), [{ type: OcgMessageType.NEW_TURN, player: 0 }, { type: OcgMessageType.WIN, player: winner, reason }]);
const fin = (winner: number, reason: number, points?: number) =>
  renderToStaticMarkup(
    <DuelView value={{ cards: new Map(), show: () => {}, seat: 0 }}>
      <Fin board={ended(winner, reason)} seat={0} room="r" vsBot opponent="Bot" lecon={{ title: "Fusion", points }} leave={() => {}} go={() => {}} onRematch={() => {}} />
    </DuelView>,
  );

it("une leçon échouée propose de réessayer, sans parler de deck", () => {
  const html = fin(1, PUZZLE_FAILED);
  for (const text of ["Leçon · Fusion", "Leçon échouée", "Réessayer", "Retour aux leçons"]) expect(html).toContain(text);
  expect(html).not.toContain("Modifier mon deck");
});

it("une leçon réussie annonce ses points la première fois, puis la récompense déjà obtenue, sans booster", () => {
  const first = fin(0, 1, LESSON_POINTS);
  expect(first).toContain("Leçon réussie");
  expect(first).toContain(`+${LESSON_POINTS} points de collection`);
  expect(first).not.toContain("Ouvrir mes boosters");
  expect(fin(0, 1, 0)).toContain("Leçon déjà réussie");
  expect(fin(0, 1)).toContain("Enregistrement de la victoire");
});

it("liste les leçons avec leur statut et garde la dernière victoire jusqu'au duel suivant", () => {
  const lessons: LessonView[] = [
    { id: "a", title: "Première", goal: "Consigne A", done: true },
    { id: "b", title: "Seconde", goal: "Consigne B", done: false },
  ];
  const html = renderToStaticMarkup(<Lecons lessons={lessons} send={() => {}} />);
  for (const text of ["Première", "Consigne A", "Réussie", "Rejouer", "Seconde", "Jouer", `+${LESSON_POINTS} points`, "1</b> réussie sur 2"]) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Lecons send={() => {}} />)).toContain("Chargement des leçons");

  const state = reduce(reduce(initialLobby, { type: "lessons", lessons }), { type: "lesson_won", id: "b", points: LESSON_POINTS });
  expect(state.lessonWon).toEqual({ type: "lesson_won", id: "b", points: LESSON_POINTS });
  expect(reduce(state, { type: "left" }).lessonWon).toBeUndefined();
});
