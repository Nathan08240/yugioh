import { useEffect } from "react";
import { LESSON_POINTS, type ClientMessage, type LessonView } from "../../server/src/protocol.ts";
import "./styles/puzzles.css";
import { Icon } from "./ui.tsx";

type Props = { lessons?: LessonView[]; send: (msg: ClientMessage) => void };

// The advanced lessons of the tutorial: short guided duels, each won in a single turn; the first win of each gives collection points.
export function Lecons({ lessons, send }: Readonly<Props>) {
  // Progression may have changed since the last visit (a lesson just won).
  useEffect(() => send({ type: "lessons" }), []);

  if (!lessons) return <p className="ecran-message">Chargement des leçons…</p>;
  const won = lessons.filter((lesson) => lesson.done).length;
  return (
    <div className="puzzles">
      <div className="puzzles__tete" data-entree>
        <div>
          <p className="surtitre">Leçons</p>
          <h1 className="titre">Techniques avancées</h1>
        </div>
        <p className="texte-2">
          <b className="chiffres">{won}</b> {won > 1 ? "réussies" : "réussie"} sur {lessons.length}
        </p>
      </div>
      <p className="texte-2" data-entree>
        Chaque leçon est un court duel guidé contre le bot : des bulles disent quoi faire et pourquoi. Gagnez avant la fin de votre tour. Première réussite : {LESSON_POINTS} points de collection.
      </p>
      <ol className="puzzles__liste">
        {lessons.map((lesson, index) => (
          <li key={lesson.id} className={lesson.done ? "puzzle panneau puzzle--fait" : "puzzle panneau"} data-entree>
            <span className="puzzle__num chiffres">{index + 1}</span>
            <div className="puzzle__texte">
              <h2>{lesson.title}</h2>
              <p className="texte-2">{lesson.goal}</p>
            </div>
            {lesson.done ? (
              <span className="puce puce--succes">
                <Icon id="ui-coche" />
                Réussie
              </span>
            ) : (
              <span className="puce">+{LESSON_POINTS} points</span>
            )}
            <button type="button" className={lesson.done ? "btn btn--fantome" : "btn"} onClick={() => send({ type: "lesson", id: lesson.id })}>
              {lesson.done ? "Rejouer" : "Jouer"}
              <span className="sr"> {lesson.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
