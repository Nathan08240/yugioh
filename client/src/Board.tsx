import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import type { Board, Card, Place, Side } from "./board.ts";
import { CardView } from "./Card.tsx";
import { cardName, phaseName, useDuelView } from "./cards.ts";
import { placeKey, pointDe, type Point } from "./question.ts";

// Cards or zones the current question lets the player click.
export type Targets = { targets: ReadonlySet<string>; picked: readonly string[]; onPick?: (key: string, point: Point) => void };

const FIVE = [0, 1, 2, 3, 4];

export function Table({ board, seat, ui }: Readonly<{ board: Board; seat: number; ui: Targets }>) {
  const opponent = 1 - seat;
  return (
    <div className="table">
      <Field side={board.players[opponent]} player={opponent} ui={ui} opponent />
      <Middle board={board} seat={seat} />
      <Field side={board.players[seat]} player={seat} ui={ui} />
    </div>
  );
}

function Field({ side, player, ui, opponent = false }: Readonly<{ side: Side; player: number; ui: Targets; opponent?: boolean }>) {
  const at = (location: OcgLocation, sequence: number): Place => ({ controller: player, location, sequence });
  return (
    <div className={opponent ? "field opponent" : "field"}>
      <div className="lane">
        <Slot place={at(OcgLocation.SZONE, 5)} card={side.spells[5]} ui={ui} label="Terrain" />
        {FIVE.map((sequence) => (
          <Slot key={sequence} place={at(OcgLocation.MZONE, sequence)} card={side.monsters[sequence]} ui={ui} label="Monstre" />
        ))}
        <Pile label="Cimetière" cards={side.grave} />
        <Pile label="Bannies" cards={side.banished} />
      </div>
      <div className="lane">
        <Pile label="Extra" count={side.extra} />
        {FIVE.map((sequence) => (
          <Slot key={sequence} place={at(OcgLocation.SZONE, sequence)} card={side.spells[sequence]} ui={ui} label="Magie/Piège" />
        ))}
        <Pile label="Deck" count={side.deck} />
        <div className="slot spacer" />
      </div>
      <div className="hand">
        {/* Hand cards have no identity of their own: the engine refers to them by position. */}
        {[...side.hand.keys()].map((sequence) => (
          <Slot key={sequence} place={at(OcgLocation.HAND, sequence)} card={side.hand[sequence]} ui={ui} />
        ))}
      </div>
    </div>
  );
}

function Slot({ place, card, ui, label }: Readonly<{ place: Place; card: Card | null; ui: Targets; label?: string }>) {
  const { show } = useDuelView();
  const key = placeKey(place);
  const target = ui.targets.has(key);
  const classes = ["slot"];
  if (target) classes.push("target");
  if (ui.picked.includes(key)) classes.push("picked");
  if (!card && !target) return <div className={classes.join(" ")}>{label && <span className="zone-label">{label}</span>}</div>;
  const reveal = () => card && show(card.code, key);
  return (
    <button
      type="button"
      className={classes.join(" ")}
      onMouseEnter={reveal}
      onFocus={reveal}
      onClick={(event) => (target ? ui.onPick?.(key, pointDe(event)) : reveal())}
    >
      {card ? <CardView code={card.code} position={card.position} location={place.location} atk={card.atk} def={card.def} /> : <span className="zone-label">{label}</span>}
    </button>
  );
}

function Pile({ label, cards, count }: Readonly<{ label: string; cards?: Card[]; count?: number }>) {
  const { cards: data, show } = useDuelView();
  const top = cards?.at(-1);
  const size = cards?.length ?? count ?? 0;
  if (!cards || cards.length === 0) {
    return (
      <div className="slot pile" title={label}>
        {size > 0 && <CardView code={0} />}
        <span className="pile-count">
          {label} {size}
        </span>
      </div>
    );
  }
  return (
    <details className="slot pile">
      <summary title={`${label} : voir les cartes`}>
        {top && <CardView code={top.code} />}
        <span className="pile-count">
          {label} {size}
        </span>
      </summary>
      <ol className="pile-list">
        {[...cards.keys()].reverse().map((sequence) => {
          const reveal = () => show(cards[sequence].code);
          return (
            <li key={sequence}>
              <button type="button" className="link" onMouseEnter={reveal} onFocus={reveal} onClick={reveal}>
                {cardName(data, cards[sequence].code)}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function Middle({ board, seat }: Readonly<{ board: Board; seat: number }>) {
  const { cards } = useDuelView();
  return (
    <div className="middle">
      <span>
        Tour {board.turn} · {board.turnPlayer === seat ? "à vous" : "à l'adversaire"} · {phaseName(board.phase)}
      </span>
      {board.chain.length > 0 && (
        <span className="chain">
          Chaîne : {board.chain.map((link, i) => `${i + 1}. ${cardName(cards, link.code)}`).join(" → ")}
        </span>
      )}
    </div>
  );
}
