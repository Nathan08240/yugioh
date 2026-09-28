import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import { useMemo, useState, type ReactNode } from "react";
import type { Board, LogEntry } from "./board.ts";
import { Table } from "./Board.tsx";
import { CardDetail } from "./Card.tsx";
import { cardName, DuelView, useCards, useDuelView } from "./cards.ts";
import type { Asked } from "./lobby.ts";
import { interaction } from "./Question.tsx";

type Props = { board: Board; seat: number; asked?: Asked; respond: (response: OcgResponse) => void; leave: () => void };

export function Duel({ board, seat, asked, respond, leave }: Readonly<Props>) {
  const cards = useCards();
  const [shown, setShown] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat }), [cards, seat]);
  return (
    <DuelView value={view}>
      <div className="duel">
        {/* A new question starts with nothing picked. */}
        <Play key={asked?.id ?? 0} board={board} seat={seat} asked={asked} respond={respond} leave={leave}>
          <CardDetail code={shown} />
        </Play>
        {board.winner !== undefined && <End winner={board.winner} seat={seat} leave={leave} />}
      </div>
    </DuelView>
  );
}

function Play({ board, seat, asked, respond, leave, children }: Readonly<Props & { children: ReactNode }>) {
  const { cards } = useDuelView();
  const [picked, setPicked] = useState<string[]>([]);
  const ui = interaction(asked?.question, { board, cards, picked, setPicked, respond });
  return (
    <>
      <Table board={board} seat={seat} ui={{ ...ui, picked }} />
      <aside className="side">
        <LifePoints board={board} seat={seat} />
        {children}
        <section className="ask" aria-live="polite">
          {asked?.retry && <p className="error">Choix refusé par le moteur : essayez autre chose.</p>}
          {ui.panel}
        </section>
        <Log log={board.log} />
        <button type="button" className="link" onClick={leave}>
          Quitter le duel
        </button>
      </aside>
    </>
  );
}

function LifePoints({ board, seat }: Readonly<{ board: Board; seat: number }>) {
  return (
    <div className="lp">
      {[1 - seat, seat].map((player) => (
        <div key={player} className={player === seat ? "lp-me" : "lp-opponent"}>
          <span>{player === seat ? "Vous" : "Adversaire"}</span>
          <strong>{Math.max(board.players[player].lp, 0)}</strong>
          <span className="muted">
            main {board.players[player].hand.length} · deck {board.players[player].deck}
          </span>
        </div>
      ))}
    </div>
  );
}

function Log({ log }: Readonly<{ log: LogEntry[] }>) {
  return (
    <div className="journal log">
      <ol>
        {/* Entries are only ever appended: their position is their identity. */}
        {[...log.keys()].map((i) => (
          <Entry key={i} entry={log[i]} />
        ))}
      </ol>
    </div>
  );
}

function Entry({ entry }: Readonly<{ entry: LogEntry }>) {
  const { seat } = useDuelView();
  let who: string | undefined;
  if (entry.player === seat) who = "Vous";
  else if (entry.player !== undefined) who = "Adversaire";
  return (
    <li className={who === "Vous" ? "mine" : undefined}>
      {who && <b>{who} </b>}
      {[...entry.parts.keys()].map((i) => {
        const part = entry.parts[i];
        return typeof part === "string" ? part : <CardName key={i} code={part.code} />;
      })}
    </li>
  );
}

function CardName({ code }: Readonly<{ code: number }>) {
  const { cards, show } = useDuelView();
  if (!code) return <>une carte face cachée</>;
  const reveal = () => show(code);
  return (
    <button type="button" className="card-name" onMouseEnter={reveal} onFocus={reveal} onClick={reveal}>
      {cardName(cards, code)}
    </button>
  );
}

function End({ winner, seat, leave }: Readonly<{ winner: number; seat: number; leave: () => void }>) {
  let title = "Match nul";
  if (winner === seat) title = "Victoire !";
  else if (winner === 1 - seat) title = "Défaite";
  return (
    <dialog open className="end">
      <h2>{title}</h2>
      <p className="muted">Le duel est terminé.</p>
      <button type="button" onClick={leave}>
        Retour à l'accueil
      </button>
    </dialog>
  );
}
