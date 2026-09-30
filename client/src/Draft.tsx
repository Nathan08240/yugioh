import { OcgType } from "@n1xx1/ocgcore-wasm";
import { useEffect, useMemo, useState } from "react";
import { isFusion } from "../../server/src/deckcheck.ts";
import type { CardInfo, ClientMessage, DraftRun } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { DuelView, has, useCards } from "./cards.ts";
import { Abandon, LimitedScreen, plural, type Limited } from "./Scelle.tsx";
import type { Page } from "./Shell.tsx";
import "./styles/draft.css";

type Send = (msg: ClientMessage) => void;
type Props = { run?: DraftRun | null; send: Send; go: (page: Page) => void };

const DRAFT: Limited = {
  name: "Draft",
  pitch: "Six boosters, carte par carte",
  rules:
    "À chaque ronde, vous et trois bots ouvrez un booster d'un même set : chacun garde une carte et passe le reste à son voisin, jusqu'à 54 cartes. Elles ne rejoignent pas votre collection.",
  opponent: "le deck d'un des bots du draft",
  start: { type: "draft_start" },
  deck: (main, extra) => ({ type: "draft_deck", main, extra }),
  abandon: { type: "draft_abandon" },
  duel: { type: "draft_duel" },
};
const PACK_SIZE = 9;
const ROUNDS = 6;

// Draft mode: the boosters drafted card by card with 3 bots, then played as the Sealed mode.
export function Draft({ run, send, go }: Readonly<Props>) {
  useEffect(() => send({ type: "draft" }), []);
  if (run?.status === "drafting") return <Choix run={run} send={send} />;
  return <LimitedScreen mode={DRAFT} run={run} send={send} go={go} />;
}

function kind(info: CardInfo | undefined): string {
  if (info && isFusion(info)) return "fusion";
  if (has(info?.type ?? 0, OcgType.SPELL)) return "magie";
  if (has(info?.type ?? 0, OcgType.TRAP)) return "piège";
  return "monstre";
}

// The booster in front of the player, face up: a click or a tap keeps a card, the server answers with the next booster.
function Choix({ run, send }: Readonly<{ run: DraftRun; send: Send }>) {
  const cards = useCards();
  const [shown, setShown] = useState<number>();
  // The reserve size when a card was sent: no second pick before the server's answer.
  const [sent, setSent] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const counts = Map.groupBy(run.pool, (card) => kind(cards.get(card.code)));
  const kept = ["monstre", "fusion", "magie", "piège"].map((name) => plural(counts.get(name)?.length ?? 0, name)).join(" · ");
  return (
    <DuelView value={view}>
      <div className="salle draft">
        <p className="surtitre" data-entree>
          Mode Draft · {run.setName}
        </p>
        <h1 className="titre" data-entree>
          Ronde {run.round} sur {ROUNDS}
        </h1>
        <p className="texte-2" data-entree>
          Choix {PACK_SIZE + 1 - run.pack.length} sur {PACK_SIZE} : gardez une carte, le reste passe à votre voisin de {run.round % 2 === 1 ? "gauche" : "droite"}.
        </p>
        <div className="draft__table">
          <ul className="draft__booster" aria-label="Booster en cours" data-entree>
            {run.pack.map((card, index) => {
              const name = cards.get(card.code)?.name ?? `la carte ${index + 1}`;
              // No printing twice in a booster: code and rarity make the key.
              return (
                <li key={`${card.code} ${card.rarity}`}>
                  <button
                    type="button"
                    className="draft__carte"
                    disabled={sent === run.pool.length}
                    aria-label={`Prendre ${name}`}
                    onPointerEnter={() => setShown(card.code)}
                    onFocus={() => setShown(card.code)}
                    onClick={() => {
                      setSent(run.pool.length);
                      send({ type: "draft_pick", index });
                    }}
                  >
                    <CardView code={card.code} rarity={card.rarity} />
                  </button>
                </li>
              );
            })}
          </ul>
          <aside className="panneau draft__detail" aria-label="Détail de la carte">
            <CardDetail code={shown} />
          </aside>
        </div>
        <p className="texte-3" role="status" data-entree>
          {plural(run.pool.length, "carte")} prise{run.pool.length > 1 ? "s" : ""} : {kept}
        </p>
        <Abandon mode={DRAFT} send={send} />
      </div>
    </DuelView>
  );
}
