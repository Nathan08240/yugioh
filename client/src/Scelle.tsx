import { useEffect, useMemo, useState } from "react";
import { countBy, deckError, EXTRA_MAX, MAIN_MAX, MAIN_MIN, type DeckDraft } from "../../server/src/deckcheck.ts";
import { SEALED_LOSSES, SEALED_REWARDS, SEALED_WINS, type ClientMessage, type DraftRun, type SealedRun } from "../../server/src/protocol.ts";
import { CardDetail } from "./Card.tsx";
import { DuelView, useCards } from "./cards.ts";
import { copiesByRarity } from "./collection.ts";
import { add, CollectionPanel, Count, DeckLines } from "./DeckBuilder.tsx";
import type { Page } from "./Shell.tsx";
import { Rewards } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;
type Run = SealedRun | DraftRun;
type Props = { run?: SealedRun | null; send: Send; go: (page: Page) => void };

// What tells the Sealed and Draft screens apart: their name, pitch, rules, bot and messages.
export type Limited = {
  name: string;
  pitch: string;
  rules: string;
  opponent: string;
  start: ClientMessage;
  deck: (main: number[], extra: number[]) => ClientMessage;
  abandon: ClientMessage;
  duel: ClientMessage;
};

const SEALED: Limited = {
  name: "Scellé",
  pitch: "Six boosters, un deck",
  rules: "Le serveur ouvre 6 boosters d'un même set, rien que pour la session : ces cartes ne rejoignent pas votre collection.",
  opponent: "un deck tiré de 6 boosters du même set",
  start: { type: "sealed_start" },
  deck: (main, extra) => ({ type: "sealed_deck", main, extra }),
  abandon: { type: "sealed_abandon" },
  duel: { type: "sealed_duel" },
};

export const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
const record = (run: Run) => `${plural(run.wins, "victoire")} sur ${SEALED_WINS} · ${plural(run.losses, "défaite")} sur ${SEALED_LOSSES}`;
const REWARDS_TEXT = SEALED_REWARDS.map((boosters, wins) => `${plural(wins, "victoire")} : ${boosters ? plural(boosters, "booster") : "rien"}`).join(" · ");

// Sealed mode: 6 boosters opened for the session only, a deck built from them, duels against the bot until 3 wins or 2 losses.
export function Scelle({ run, send, go }: Readonly<Props>) {
  useEffect(() => send({ type: "sealed" }), []);
  return <LimitedScreen mode={SEALED} run={run} send={send} go={go} />;
}

// A Sealed or Draft session once its reserve is known.
export function LimitedScreen({ mode, run, send, go }: Readonly<{ mode: Limited; run?: Run | null; send: Send; go: (page: Page) => void }>) {
  if (run === undefined) return <p className="ecran-message">Chargement de la session…</p>;
  if (run?.status === "building") return <Construction mode={mode} run={run} send={send} />;
  if (run?.status === "playing") return <Session mode={mode} run={run} send={send} />;
  return <Bilan mode={mode} run={run} send={send} go={go} />;
}

// No session yet, or the end of the last one.
function Bilan({ mode, run, send, go }: Readonly<{ mode: Limited; run: Run | null; send: Send; go: (page: Page) => void }>) {
  return (
    <div className="salle">
      <p className="surtitre" data-entree>
        Mode {mode.name}
      </p>
      {run ? (
        <>
          <h1 className="titre" data-entree>
            {run.status === "done" ? "Session terminée" : "Session abandonnée"}
          </h1>
          <p className="texte-2" data-entree>
            {run.setName} · {record(run)}
          </p>
          {run.boosters > 0 ? <Rewards rewards={{ boosters: run.boosters }} /> : <p className="texte-2">Aucun booster gagné.</p>}
        </>
      ) : (
        <h1 className="titre" data-entree>
          {mode.pitch}
        </h1>
      )}
      <p className="texte-2" data-entree>
        {mode.rules} Construisez un deck d'au moins {MAIN_MIN} cartes avec elles, puis affrontez le bot jusqu'à {SEALED_WINS} victoires ou {SEALED_LOSSES} défaites.
      </p>
      <p className="texte-3" data-entree>
        Récompenses en fin de session : {REWARDS_TEXT}. Abandonner ne rapporte rien.
      </p>
      <div className="deck-actions" data-entree>
        <button type="button" className="btn btn--grand" onClick={() => send(mode.start)}>
          {run ? "Nouvelle session" : "Commencer une session"}
        </button>
        {run && run.boosters > 0 && (
          <button type="button" className="btn btn--fantome" onClick={() => go("boosters")}>
            Ouvrir mes boosters
          </button>
        )}
      </div>
    </div>
  );
}

// A first click asks for confirmation, the second one gives the session up.
export function Abandon({ mode, send }: Readonly<{ mode: Limited; send: Send }>) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      className="lien deck-supprimer"
      onClick={() => {
        if (confirming) send(mode.abandon);
        setConfirming(!confirming);
      }}
    >
      {confirming ? "Confirmer l'abandon (sans récompense)" : "Abandonner la session"}
    </button>
  );
}

// The deck builder, with the reserve in place of the collection. The deck is validated once, by the server.
function Construction({ mode, run, send }: Readonly<{ mode: Limited; run: Run; send: Send }>) {
  const cards = useCards();
  const [shown, setShown] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const [draft, setDraft] = useState<DeckDraft | undefined>({ name: mode.name, main: [], extra: [] });
  const reserve = useMemo(() => [...countBy(run.pool.map((card) => card.code))], [run]);
  const copies = useMemo(() => {
    const rarities = [...Map.groupBy(run.pool, (card) => `${card.code} ${card.rarity}`).values()].map((group): [number, string, number] => [group[0].code, group[0].rarity, group.length]);
    return copiesByRarity(reserve, rarities);
  }, [reserve, run]);

  if (cards.size === 0 || !draft) return <p className="ecran-message">Chargement de la réserve…</p>;
  const error = deckError(draft, (code) => cards.get(code), new Map(reserve), "la réserve");
  return (
    <DuelView value={view}>
      <div className="atelier">
        <CollectionPanel collection={reserve} copies={copies} draft={draft} onAdd={(code) => setDraft(add(draft, code, cards.get(code)))} onCreate={(built) => setDraft({ ...built, name: mode.name })} suggest={false} />
        <aside className="panneau atelier__detail" aria-label="Détail de la carte" data-entree>
          <CardDetail code={shown} copies={shown === undefined ? undefined : copies.get(shown)} />
        </aside>
        <aside className="panneau atelier__deck" aria-label={`Deck ${mode.name}`} data-entree>
          <p className="surtitre">
            Mode {mode.name} · {run.setName}
          </p>
          <p className="texte-3">Réserve de {run.pool.length} cartes. Le deck ne pourra plus changer une fois validé.</p>
          <div className="deck-compteurs">
            <Count label="Principal" rule={`${MAIN_MIN} à ${MAIN_MAX}`} count={draft.main.length} ok={draft.main.length >= MAIN_MIN && draft.main.length <= MAIN_MAX} />
            <Count label="Extra" rule={`${EXTRA_MAX} max.`} count={draft.extra.length} ok={draft.extra.length <= EXTRA_MAX} />
          </div>
          <DeckLines draft={draft} setDraft={setDraft} />
          <p className={error ? "message message--erreur" : "message message--succes"} role="status">
            {error ?? "Deck valide : prêt pour les duels."}
          </p>
          <div className="deck-actions">
            <button type="button" className="btn" disabled={Boolean(error)} onClick={() => send(mode.deck(draft.main, draft.extra))}>
              Valider le deck
            </button>
          </div>
          <Abandon mode={mode} send={send} />
        </aside>
      </div>
    </DuelView>
  );
}

// Between two duels: the record so far and the next duel.
function Session({ mode, run, send }: Readonly<{ mode: Limited; run: Run; send: Send }>) {
  return (
    <div className="salle">
      <p className="surtitre" data-entree>
        Mode {mode.name} · {run.setName}
      </p>
      <h1 className="titre" data-entree>
        Duel {run.wins + run.losses + 1}
      </h1>
      <p className="texte-2" data-entree>
        {record(run)} · deck de {run.main?.length ?? 0} cartes
      </p>
      <p className="texte-3" data-entree>
        Contre le bot au niveau Normal, avec {mode.opponent}. {REWARDS_TEXT}.
      </p>
      <button type="button" className="btn btn--grand" data-entree onClick={() => send(mode.duel)}>
        Lancer le duel
      </button>
      <Abandon mode={mode} send={send} />
    </div>
  );
}
