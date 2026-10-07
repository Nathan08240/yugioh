import { useEffect } from "react";
import { PUZZLE_DIFFICULTIES, type ClientMessage, type PuzzleDifficulty, type PuzzleView } from "../../server/src/protocol.ts";
import type { Rule } from "./regles.tsx";
import "./styles/puzzles.css";
import { Icon } from "./ui.tsx";

// The goal of the puzzle during its duel, with the rules badge.
export const puzzleRule = (puzzle: PuzzleView): Rule[] => [
  { title: puzzle.title, details: [puzzle.goal, "Faites tomber les LP adverses à 0 avant la fin de ce tour : le finir échoue le puzzle."] },
];

type Props = { puzzles?: PuzzleView[]; send: (msg: ClientMessage) => void };

const LEVELS: Record<PuzzleDifficulty, string> = { easy: "Facile", medium: "Moyen", hard: "Difficile" };

function Solved({ puzzles }: Readonly<{ puzzles: PuzzleView[] }>) {
  const solved = puzzles.filter((puzzle) => puzzle.done).length;
  return (
    <p className="texte-2">
      <b className="chiffres">{solved}</b> {solved > 1 ? "réussis" : "réussi"} sur {puzzles.length}
    </p>
  );
}

// The puzzles by level, each won in a single turn; the first success of each gives a booster.
export function Puzzles({ puzzles, send }: Readonly<Props>) {
  // Progression may have changed since the last visit (a puzzle just solved).
  useEffect(() => send({ type: "puzzles" }), []);

  if (!puzzles) return <p className="ecran-message">Chargement des puzzles…</p>;
  return (
    <div className="puzzles">
      <div className="puzzles__tete" data-entree>
        <div>
          <p className="surtitre">Puzzles</p>
          <h1 className="titre">Gagnez ce tour-ci</h1>
        </div>
        <Solved puzzles={puzzles} />
      </div>
      <p className="texte-2" data-entree>
        Faites tomber les LP adverses à 0 avant la fin de votre tour : le finir échoue le puzzle. Premier succès : 1 booster.
      </p>
      {PUZZLE_DIFFICULTIES.map((level) => {
        const group = puzzles.filter((puzzle) => puzzle.difficulty === level);
        if (group.length === 0) return null;
        return (
          <section key={level} className="puzzles__niveau" aria-label={LEVELS[level]} data-entree>
            <div className="puzzles__tete">
              <h2 className="puzzles__niveau-titre">{LEVELS[level]}</h2>
              <Solved puzzles={group} />
            </div>
            <ol className="puzzles__liste">
              {group.map((puzzle, index) => (
                <li key={puzzle.id} className={puzzle.done ? "puzzle panneau puzzle--fait" : "puzzle panneau"}>
                  <span className="puzzle__num chiffres">{index + 1}</span>
                  <div className="puzzle__texte">
                    <h3>{puzzle.title}</h3>
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
          </section>
        );
      })}
    </div>
  );
}
