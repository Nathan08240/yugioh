import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { KEEP_COPIES, type ClientMessage } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { cardName, DuelView, useCards } from "./cards.ts";
import { bestRarity, copiesByRarity, ownedCodes, setProgress } from "./collection.ts";
import { WishButton } from "./Souhait.tsx";
import { WISH_MAX } from "./wishlist.ts";
import "./styles/classeur.css";
import "./styles/collection.css";
import { BestRarity } from "./ui.tsx";

type SetCards = { code: string; name: string; date: string; cards: number[] };

// Binder: one page per booster or starter deck, the cards not owned yet greyed out.
type Props = { collection?: [number, number][]; rarities?: [number, string, number][]; wishlist?: number[]; points?: number; send: (msg: ClientMessage) => void };

export function Classeur({ collection, rarities, wishlist, points, send }: Readonly<Props>) {
  const cards = useCards();
  const [sets, setSets] = useState<SetCards[]>();
  const [selected, setSelected] = useState(0);
  const [shown, setShown] = useState<number>();
  const [onlyWished, setOnlyWished] = useState(false);
  // Points to obtain each booster card.
  const [costs, setCosts] = useState<ReadonlyMap<number, number>>(new Map());
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const owned = useMemo(() => ownedCodes(collection ?? []), [collection]);
  const quantities = useMemo(() => new Map(collection), [collection]);
  const copies = useMemo(() => copiesByRarity(collection ?? [], rarities ?? []), [collection, rarities]);
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
    fetch("/api/craft")
      .then((res) => res.json())
      .then((data: [number, number][]) => setCosts(new Map(data)))
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
                    <CardView code={code} rarity={bestRarity(copies.get(code))} className={quantity > 0 ? undefined : "est-manquante"} />
                  </button>
                  <BestRarity copies={copies.get(code)} />
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
          <CardDetail code={shown} copies={shown === undefined ? undefined : copies.get(shown)} />
          {shown !== undefined && (
            <>
              <WishButton code={shown} wished={wished.has(shown)} send={send} label />
              {wished.has(shown) && owned.has(shown) && <p className="puce puce--succes">Possédée : souhait exaucé</p>}
              <Craft key={shown} code={shown} quantity={quantities.get(shown) ?? 0} cost={costs.get(shown)} points={points ?? 0} send={send} />
            </>
          )}
        </aside>
      </div>
    </DuelView>
  );
}

// Obtains a Common copy of a booster card owned fewer than KEEP_COPIES times, once the cost is confirmed.
function Craft({ code, quantity, cost, points, send }: Readonly<{ code: number; quantity: number; cost?: number; points: number; send: (msg: ClientMessage) => void }>) {
  const [confirming, setConfirming] = useState(false);
  if (cost === undefined || quantity >= KEEP_COPIES) return null;
  if (!confirming) {
    return (
      <button type="button" className="btn btn--fantome" disabled={points < cost} onClick={() => setConfirming(true)}>
        Obtenir en Commune · {cost} points
      </button>
    );
  }
  return (
    <div className="obtenir">
      <p className="texte-2">
        Dépenser <b className="chiffres">{cost}</b> de vos {points} points pour 1 exemplaire en Commune ?
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setConfirming(false);
          send({ type: "craft", code });
        }}
      >
        Confirmer
      </button>
      <button type="button" className="btn btn--fantome" onClick={() => setConfirming(false)}>
        Annuler
      </button>
    </div>
  );
}
