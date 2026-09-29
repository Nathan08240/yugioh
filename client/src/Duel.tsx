import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import { useMemo, useState, type ReactNode } from "react";
import type { Board, LogEntry } from "./board.ts";
import { Table } from "./Board.tsx";
import { CardDetail } from "./Card.tsx";
import { cardName, DuelView, useCards, useDuelView, useSystemStrings, type Strings } from "./cards.ts";
import type { Asked } from "./lobby.ts";
import { interaction } from "./Question.tsx";
import "./styles/duel.css";

type Props = { board: Board; seat: number; asked?: Asked; respond: (response: OcgResponse) => void; leave: () => void };

// The end of the duel (Fin.tsx) is drawn over the board by the lobby.
export function Duel({ board, seat, asked, respond, leave }: Readonly<Props>) {
  const cards = useCards();
  const strings = useSystemStrings();
  const [shown, setShown] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat }), [cards, seat]);
  return (
    <DuelView value={view}>
      <div className="duel ancien">
        {/* A new question starts with nothing picked. */}
        <Play key={asked?.id ?? 0} board={board} seat={seat} asked={asked} respond={respond} leave={leave} strings={strings}>
          <CardDetail code={shown} />
        </Play>
      </div>
    </DuelView>
  );
}

function Play({ board, seat, asked, respond, leave, strings, children }: Readonly<Props & { strings: Strings; children: ReactNode }>) {
  const { cards } = useDuelView();
  const [picked, setPicked] = useState<string[]>([]);
  const ui = interaction(asked?.question, { board, cards, strings, picked, setPicked, respond });
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
