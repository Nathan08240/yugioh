import { useState } from "react";
import { KEEP_COPIES, type ClientMessage, type DeckResult } from "../../server/src/protocol.ts";
import { Classeur } from "./Classeur.tsx";
import { cardName, rarityLabel, useCards } from "./cards.ts";
import { DeckBuilder } from "./DeckBuilder.tsx";
import type { DeckList, LobbyState } from "./lobby.ts";

type Send = (msg: ClientMessage) => void;
type Props = {
  collection?: [number, number][];
  rarities?: [number, string, number][];
  decks?: DeckList;
  results?: DeckResult[];
  wishlist?: number[];
  points?: number;
  conversion?: LobbyState["conversion"];
  send: Send;
};

// The collection screen: deck building, or the binder of each booster.
export function Collection({ collection, rarities, decks, results, wishlist, points, conversion, send }: Readonly<Props>) {
  const [tab, setTab] = useState<"decks" | "classeur">("decks");
  return (
    <>
      <div className="collection__barre">
        <div className="segments onglets-collection" role="group" aria-label="Affichage de la collection">
          <button type="button" aria-pressed={tab === "decks"} onClick={() => setTab("decks")}>
            Decks
          </button>
          <button type="button" aria-pressed={tab === "classeur"} onClick={() => setTab("classeur")}>
            Classeur
          </button>
        </div>
        <Points points={points} conversion={conversion} send={send} />
      </div>
      {tab === "decks" ? (
        <DeckBuilder collection={collection} rarities={rarities} decks={decks} results={results} send={send} />
      ) : (
        <Classeur collection={collection} rarities={rarities} wishlist={wishlist} points={points} send={send} />
      )}
    </>
  );
}

// Collection points, and the conversion of the duplicates once the player has seen and confirmed its preview.
function Points({ points, conversion, send }: Readonly<{ points?: number; conversion?: LobbyState["conversion"]; send: Send }>) {
  const cards = useCards();
  const [asked, setAsked] = useState(false);
  const preview = asked ? conversion : undefined;
  return (
    <div className="points">
      <span>
        Points de collection : <b className="chiffres">{points ?? "…"}</b>
      </span>
      <button
        type="button"
        className="btn btn--fantome"
        onClick={() => {
          setAsked(true);
          send({ type: "convert_preview" });
        }}
      >
        Convertir les doublons
      </button>
      {preview && (
        <section className="panneau conversion" aria-label="Aperçu de la conversion">
          {preview.cards.length === 0 ? (
            <p>Aucun doublon : chaque carte est gardée jusqu'à {KEEP_COPIES} exemplaires.</p>
          ) : (
            <>
              <p>
                Les exemplaires au-delà de {KEEP_COPIES}, les moins rares d'abord, deviennent <b className="chiffres">{preview.points}</b> points :
              </p>
              <ul>
                {preview.cards.map(([code, rarity, quantity]) => (
                  <li key={`${code}-${rarity}`}>
                    {cardName(cards, code)} · {rarity ? rarityLabel(rarity) : "rareté inconnue"} <b className="chiffres">×{quantity}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="conversion__actions">
            {preview.cards.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAsked(false);
                  send({ type: "convert", points: preview.points });
                }}
              >
                Convertir
              </button>
            )}
            <button type="button" className="btn btn--fantome" onClick={() => setAsked(false)}>
              {preview.cards.length > 0 ? "Annuler" : "Fermer"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
