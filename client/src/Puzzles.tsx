import { useEffect } from "react";
import type { ClientMessage, PuzzleView } from "../../server/src/protocol.ts";
import type { Rule } from "./regles.tsx";
import "./styles/puzzles.css";
import { Icon } from "./ui.tsx";

// The goal of the puzzle during its duel, with the rules badge.
export const puzzleRule = (puzzle: PuzzleView): Rule[] => [
  { title: puzzle.title, details: [puzzle.goal, "Faites tomber les LP adverses à 0 avant la fin de ce tour : le finir échoue le puzzle."] },
];

type Props = { puzzles?: PuzzleView[]; send: (msg: ClientMessage) => void };

// The puzzles by growing difficulty, each won in a single turn; the first success of each gives a booster.
export function Puzzles({ puzzles, send }: Readonly<Props>) {
  // Progression may have changed since the last visit (a puzzle just solved).
  useEffect(() => send({ type: "puzzles" }), []);

  if (!puzzles) return <p className="ecran-message">Chargement des puzzles…</p>;
  const solved = puzzles.filter((puzzle) => puzzle.done).length;
  return (
    <div className="puzzles">
      <div className="puzzles__tete" data-entree>
        <div>
          <p className="surtitre">Puzzles</p>
          <h1 className="titre">Gagnez ce tour-ci</h1>
        </div>
        <p className="texte-2">
          <b className="chiffres">{solved}</b> {solved > 1 ? "réussis" : "réussi"} sur {puzzles.length}
        </p>
      </div>
      <p className="texte-2" data-entree>
        Faites tomber les LP adverses à 0 avant la fin de votre tour : le finir échoue le puzzle. Premier succès : 1 booster.
      </p>
      <ol className="puzzles__liste">
        {puzzles.map((puzzle, index) => (
          <li key={puzzle.id} className={puzzle.done ? "puzzle panneau puzzle--fait" : "puzzle panneau"} data-entree>
            <span className="puzzle__num chiffres">{index + 1}</span>
            <div className="puzzle__texte">
              <h2>{puzzle.title}</h2>
              <p className="texte-2">{puzzle.goal}</p>
            </div>
            {puzzle.done ? (
              <span className="puce puce--succes">
                <Icon id="ui-coche" />
                Réussi
              </span>
            ) : (
              <span className="puce">
                <Icon id="ui-booster" />1 booster
              </span>
            )}
            <button type="button" className={puzzle.done ? "btn btn--fantome" : "btn"} onClick={() => send({ type: "puzzle", id: puzzle.id })}>
              {puzzle.done ? "Rejouer" : "Jouer"}
              <span className="sr"> {puzzle.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
