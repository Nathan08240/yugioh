import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import { useEffect, useState } from "react";
import { newBoard, playAll, type Board, type Message } from "./board.ts";
import { Duel } from "./Duel.tsx";
import type { ReplayEmote, Seat } from "../../server/src/protocol.ts";
import type { ReplayView, ShownEmote } from "./lobby.ts";
import { sequences } from "./motion.ts";
import "./styles/revoir.css";

const VITESSES = [1, 2, 4];
// Pause between two batches at ×1, polled until the animations let the next one in.
const PAS = 600;
const SAUT = 50;

// `index`: batches shown. `scene` changes on a jump to the next turn: the board is shown again at once, without animation.
// `emotes`: the last emote of each seat so far.
type Lecture = { index: number; board: Board; feed?: { id: number; messages: Message[] }; scene: number; emotes: Partial<Record<Seat, ShownEmote>> };

// The emotes sent while batches `from` to `to` went by, the last of each seat showing over those of `shown`.
function montrer(shown: Lecture["emotes"], emotes: readonly ReplayEmote[], from: number, to: number): Lecture["emotes"] {
  return emotes.filter(({ at }) => at > from && at <= to).reduce((acc, { seat, id }) => ({ ...acc, [seat]: { id, n: (acc[seat]?.n ?? 0) + 1 } }), shown);
}

export function debut(replay: ReplayView): Lecture {
  const other = replay.opponentLp ?? replay.lp;
  const board = newBoard(replay.seat === 0 ? [replay.lp, other] : [other, replay.lp], replay.decks, replay.extras);
  return { index: 0, board, scene: 0, emotes: montrer({}, replay.emotes, -1, 0) };
}

// Past the next batch that starts a turn, or at the end.
export function tourSuivant(batches: readonly (readonly Message[])[], index: number): number {
  const next = batches.findIndex((batch, i) => i >= index && batch.some((msg) => msg.type === OcgMessageType.NEW_TURN));
  return next === -1 ? batches.length : next + 1;
}

// A jump (`saut`) keeps only the emotes sent during it: the scene is mounted again, older bubbles would show anew.
export function avancer(lecture: Lecture, batches: readonly Message[][], to: number, saut = false, emotes: readonly ReplayEmote[] = []): Lecture {
  const messages = batches.slice(lecture.index, to).flat();
  const board = playAll(lecture.board, messages);
  const shown = montrer(saut ? {} : lecture.emotes, emotes, lecture.index, to);
  if (saut) return { ...lecture, index: to, board, scene: lecture.scene + 1, emotes: shown };
  return { ...lecture, index: to, board, emotes: shown, feed: { id: (lecture.feed?.id ?? 0) + 1, messages } };
}

function resultat(board: Board, seat: number): string {
  if (board.winner === seat) return "Victoire";
  if (board.winner === 1 - seat) return "Défaite";
  return "Match nul";
}

// A finished duel played again from what the server sent this player, with play and pause, speed and the next turn.
export function Revoir({ replay, pseudo, avatar, leave }: Readonly<{ replay: ReplayView; pseudo?: string; avatar?: number; leave: () => void }>) {
  const { batches, emotes } = replay;
  const [lecture, setLecture] = useState(() => debut(replay));
  const [enLecture, setEnLecture] = useState(true);
  const [vitesse, setVitesse] = useState(1);
  const [saut, setSaut] = useState(false);
  const fini = lecture.index >= batches.length;

  // The next batch goes in once fewer than `vitesse` animations are queued: at ×1, each one plays to its end.
  useEffect(() => {
    if (!enLecture || saut || fini) return;
    const timer = setInterval(() => {
      if (Number(sequences.busy) + sequences.waiting < vitesse) setLecture((l) => avancer(l, batches, l.index + 1, false, emotes));
    }, PAS / vitesse);
    return () => clearInterval(timer);
  }, [enLecture, saut, fini, vitesse, batches, emotes]);

  // The animations under way are skipped first: the jump shows the board of the next turn at once.
  useEffect(() => {
    if (!saut) return;
    const timer = setInterval(() => {
      if (sequences.busy || sequences.waiting > 0) {
        sequences.skip();
        return;
      }
      setLecture((l) => avancer(l, batches, tourSuivant(batches, l.index), true, emotes));
      setSaut(false);
    }, SAUT);
    return () => clearInterval(timer);
  }, [saut, batches, emotes]);

  const controles = (
    <div className="rejeu">
      <p className="surtitre">
        Rejeu · {lecture.index} / {batches.length}
      </p>
      <div className="rejeu__boutons">
        <button type="button" className="btn" disabled={fini} onClick={() => setEnLecture(!enLecture)}>
          {enLecture && !fini ? "Pause" : "Lecture"}
        </button>
        <button type="button" className="btn btn--fantome" disabled={fini || saut} onClick={() => setSaut(true)}>
          Tour suivant
        </button>
      </div>
      <div className="rejeu__boutons" role="group" aria-label="Vitesse">
        {VITESSES.map((choix) => (
          <button key={choix} type="button" className="btn btn--fantome" aria-pressed={choix === vitesse} onClick={() => setVitesse(choix)}>
            ×{choix}
          </button>
        ))}
      </div>
      {fini && lecture.board.winner !== undefined && <p className="rejeu__fin">Fin du duel : {resultat(lecture.board, replay.seat)}</p>}
      <button type="button" className="btn btn--fantome" onClick={leave}>
        Quitter le rejeu
      </button>
    </div>
  );
  return (
    <Duel
      key={lecture.scene}
      board={lecture.board}
      seat={replay.seat}
      feed={lecture.feed}
      emotes={lecture.emotes}
      respond={() => {}}
      leave={leave}
      surrender={() => {}}
      lp={replay.lp}
      opponentLp={replay.opponentLp}
      pseudo={pseudo}
      avatar={avatar}
      opponent={replay.opponent}
      spectateur
      rejeu={controles}
    />
  );
}
