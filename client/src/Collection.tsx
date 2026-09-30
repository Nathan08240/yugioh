import { useState } from "react";
import type { ClientMessage, DeckResult } from "../../server/src/protocol.ts";
import { Classeur } from "./Classeur.tsx";
import { DeckBuilder } from "./DeckBuilder.tsx";
import type { DeckList } from "./lobby.ts";

type Props = { collection?: [number, number][]; rarities?: [number, string, number][]; decks?: DeckList; results?: DeckResult[]; send: (msg: ClientMessage) => void };

// The collection screen: deck building, or the binder of each booster.
export function Collection({ collection, rarities, decks, results, send }: Readonly<Props>) {
  const [tab, setTab] = useState<"decks" | "classeur">("decks");
  return (
    <>
      <div className="segments onglets-collection" role="group" aria-label="Affichage de la collection">
        <button type="button" aria-pressed={tab === "decks"} onClick={() => setTab("decks")}>
          Decks
        </button>
        <button type="button" aria-pressed={tab === "classeur"} onClick={() => setTab("classeur")}>
          Classeur
        </button>
      </div>
      {tab === "decks" ? <DeckBuilder collection={collection} rarities={rarities} decks={decks} results={results} send={send} /> : <Classeur collection={collection} rarities={rarities} send={send} />}
    </>
  );
}
