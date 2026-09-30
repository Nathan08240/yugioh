import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { cardName, DuelView, useCards } from "./cards.ts";
import { ownedCodes, setProgress } from "./collection.ts";
import { WishButton } from "./Souhait.tsx";
import { WISH_MAX } from "./wishlist.ts";
import "./styles/classeur.css";
import "./styles/collection.css";

type SetCards = { code: string; name: string; date: string; cards: number[] };

// Binder: one page per booster or starter deck, the cards not owned yet greyed out.
export function Classeur({ collection, wishlist, send }: Readonly<{ collection?: [number, number][]; wishlist?: number[]; send: (msg: ClientMessage) => void }>) {
  const cards = useCards();
  const [sets, setSets] = useState<SetCards[]>();
  const [selected, setSelected] = useState(0);
  const [shown, setShown] = useState<number>();
  const [onlyWished, setOnlyWished] = useState(false);
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const owned = useMemo(() => ownedCodes(collection ?? []), [collection]);
  const quantities = useMemo(() => new Map(collection), [collection]);
  const wished = useMemo(() => new Set(wishlist), [wishlist]);
  const set = sets?.[selected];
  const setCards = useMemo(
    () => set?.cards.filter((code) => !onlyWished || wished.has(code)).toSorted((a, b) => (cards.get(a)?.name ?? "").localeCompare(cards.get(b)?.name ?? "")) ?? [],
    [set, cards, onlyWished, wished],
  );

  // Once per visit of the screen: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "collection" });
    send({ type: "wishlist" });
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
          <button type="button" className="btn btn--fantome classeur__filtre" aria-pressed={onlyWished} onClick={() => setOnlyWished(!onlyWished)}>
            ♥ Souhaits ({wished.size} / {WISH_MAX})
          </button>
          {onlyWished && setCards.length === 0 && <p className="texte-2">Aucun souhait dans ce set.</p>}
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
                    <CardView code={code} className={quantity > 0 ? undefined : "est-manquante"} />
                  </button>
                  {quantity > 0 && (
                    <span className="qte" aria-hidden="true">
                      ×{quantity}
                    </span>
                  )}
                  {(quantity === 0 || wished.has(code)) && <WishButton code={code} wished={wished.has(code)} send={send} />}
                </li>
              );
            })}
          </ul>
        </section>
        <aside className="panneau classeur__detail" aria-label="Détail de la carte" data-entree>
          <CardDetail code={shown} />
          {shown !== undefined && (
            <>
              <WishButton code={shown} wished={wished.has(shown)} send={send} label />
              {wished.has(shown) && owned.has(shown) && <p className="puce puce--succes">Possédée : souhait exaucé</p>}
            </>
          )}
        </aside>
      </div>
    </DuelView>
  );
}
