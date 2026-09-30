import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { cardName, DuelView, useCards } from "./cards.ts";
import { bestRarity, copiesByRarity, ownedCodes, setProgress } from "./collection.ts";
import "./styles/classeur.css";
import "./styles/collection.css";
import { BestRarity } from "./ui.tsx";

type SetCards = { code: string; name: string; date: string; cards: number[] };

// Binder: one page per booster or starter deck, the cards not owned yet greyed out.
type Props = { collection?: [number, number][]; rarities?: [number, string, number][]; send: (msg: ClientMessage) => void };

export function Classeur({ collection, rarities, send }: Readonly<Props>) {
  const cards = useCards();
  const [sets, setSets] = useState<SetCards[]>();
  const [selected, setSelected] = useState(0);
  const [shown, setShown] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const owned = useMemo(() => ownedCodes(collection ?? []), [collection]);
  const quantities = useMemo(() => new Map(collection), [collection]);
  const copies = useMemo(() => copiesByRarity(collection ?? [], rarities ?? []), [collection, rarities]);
  const set = sets?.[selected];
  const setCards = useMemo(() => set?.cards.toSorted((a, b) => (cards.get(a)?.name ?? "").localeCompare(cards.get(b)?.name ?? "")) ?? [], [set, cards]);

  // Once per visit of the screen: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "collection" });
    fetch("/api/sets")
      .then((res) => res.json())
      .then((data: SetCards[]) => setSets(data))
      .catch((error: unknown) => console.error(error));
  }, []);

  if (!sets || !set || !collection || cards.size === 0) return <p className="ecran-message">Chargement du classeur…</p>;
  const current = setProgress(set.cards, owned);
  return (
    <DuelView value={view}>
      <div className="classeur">
        <nav className="panneau classeur__sets" aria-label="Sets" data-entree>
          <ul>
            {sets.map((candidate, index) => {
              const progress = setProgress(candidate.cards, owned);
              return (
                <li key={candidate.code}>
                  <button type="button" aria-pressed={index === selected} onClick={() => setSelected(index)}>
                    <span className="classeur__code chiffres">{candidate.code}</span>
                    <span className="classeur__nom">{candidate.name}</span>
                    <span className="classeur__score chiffres">
                      {progress.owned} / {progress.total} · {progress.percent} %
                    </span>
                    <span className="classeur__jauge" aria-hidden="true" style={{ "--pct": `${progress.percent}%` } as CSSProperties} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <section className="classeur__page" aria-label={set.name} data-entree>
          <h2 className="titre-panneau">{set.name}</h2>
          <p className="texte-3">
            {current.owned} cartes possédées sur {current.total} ({current.percent} %) · {current.total - current.owned} manquantes
          </p>
          <ul className="grille-collection">
            {setCards.map((code) => {
              const quantity = quantities.get(code) ?? 0;
              return (
                <li key={code}>
                  <button
                    type="button"
                    aria-label={`${cardName(cards, code)} : ${quantity > 0 ? `${quantity} possédée${quantity > 1 ? "s" : ""}` : "manquante"}`}
                    onMouseEnter={() => setShown(code)}
                    onFocus={() => setShown(code)}
                    onClick={() => setShown(code)}
                  >
                    <CardView code={code} rarity={bestRarity(copies.get(code))} className={quantity > 0 ? undefined : "est-manquante"} />
                  </button>
                  <BestRarity copies={copies.get(code)} />
                  {quantity > 0 && (
                    <span className="qte" aria-hidden="true">
                      ×{quantity}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <aside className="panneau classeur__detail" aria-label="Détail de la carte" data-entree>
          <CardDetail code={shown} copies={shown === undefined ? undefined : copies.get(shown)} />
        </aside>
      </div>
    </DuelView>
  );
}
