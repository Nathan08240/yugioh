import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { rarityKey, rarityLabel } from "./cards.ts";
import type { Wonder } from "./lobby.ts";
import { prefersReduced } from "./motion.ts";
import { faceDownOrder, LOOK_MS, SHUFFLE_MS, SHUFFLE_ROUNDS, slideOffsets, type Phase } from "./pioche.ts";
import "./styles/pioche.css";

type Drawn = Exclude<Wonder, { status: "available" }>;
type Props = { wonder: Drawn; send: (msg: ClientMessage) => void; collection: () => void; close: () => void };

const HELP: Record<Phase, string> = {
  look: "Mémorisez ces cinq cartes : elles vont être retournées puis mélangées.",
  shuffle: "Les cartes sont mélangées…",
  choose: "Choisissez une carte à l'aveugle : elle rejoint votre collection.",
  result: "",
};

// Wonder pick: the five cards face up, turned over and shuffled, then one is kept. The order and the pick are the server's.
export function Pioche({ wonder, send, collection, close }: Readonly<Props>) {
  const done = wonder.status === "picked";
  const [phase, setPhase] = useState<Phase>("look");
  const [round, setRound] = useState(-1);
  const [chosen, setChosen] = useState<number>();
  const [revealed, setRevealed] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const current: Phase = done ? "result" : phase;

  useEffect(() => {
    if (current !== "look") return;
    const id = setTimeout(() => setPhase("shuffle"), LOOK_MS);
    return () => clearTimeout(id);
  }, [current]);

  useEffect(() => {
    if (current !== "shuffle") return;
    const last = round >= SHUFFLE_ROUNDS.length - 1;
    const id = setTimeout(() => {
      if (last || prefersReduced()) setPhase("choose");
      else setRound(round + 1);
    }, SHUFFLE_MS);
    return () => clearTimeout(id);
  }, [current, round]);

  useEffect(() => {
    if (current !== "result") return;
    const id = setTimeout(() => setRevealed(true), 100);
    return () => clearTimeout(id);
  }, [current]);

  useEffect(() => first.current?.focus(), [current]);

  const shown = done ? faceDownOrder(wonder.cards, wonder.shuffle) : wonder.cards;
  const offsets = slideOffsets(shown.length, current === "shuffle" ? round : -1);
  const faceUp = current === "look" || revealed;
  const pick = (index: number) => {
    setChosen(index);
    send({ type: "wonder_pick", index });
  };

  return (
    <div className="pioche ecran--scene" role="dialog" aria-modal="true" aria-label="Pioche miracle">
      <p className="surtitre">Pioche miracle</p>
      <p className="pioche__aide" role="status">
        {current === "result" ? "La carte choisie rejoint votre collection." : HELP[current]}
      </p>
      <ol className="pioche__cartes" aria-label="Cartes de la pioche miracle">
        {[...shown.keys()].map((index) => (
          // A slot keeps its place while its card changes: the flip never jumps.
          <li key={index} style={{ "--dx": offsets[index], "--ordre": done && wonder.picked === index ? 0 : 1 } as CSSProperties}>
            <button
              type="button"
              className={`pioche__carte${faceUp ? "" : " est-cachee"}${done && wonder.picked === index ? " est-choisie" : ""}`}
              data-r={rarityKey(shown[index].rarity)}
              disabled={current !== "choose" || chosen !== undefined}
              aria-label={faceUp ? rarityLabel(shown[index].rarity) : `Carte face cachée ${index + 1}`}
              onClick={() => pick(index)}
              ref={index === 0 ? first : undefined}
            >
              <CardView code={shown[index].code} rarity={shown[index].rarity} />
              <span className="carte dos pioche__dos" />
            </button>
            {done && revealed && <span className="pioche__rarete">{wonder.picked === index ? `Gardée · ${rarityLabel(shown[index].rarity)}` : rarityLabel(shown[index].rarity)}</span>}
          </li>
        ))}
      </ol>
      <div className="pioche__actions">
        {current === "look" && (
          <button type="button" className="btn btn--grand" onClick={() => setPhase("shuffle")}>
            Retourner les cartes
          </button>
        )}
        {current === "result" && (
          <button type="button" className="btn btn--grand" onClick={collection}>
            Voir la collection
          </button>
        )}
        <button type="button" className="btn btn--fantome" onClick={close}>
          {current === "result" ? "Retour aux boosters" : "Plus tard"}
        </button>
      </div>
    </div>
  );
}
