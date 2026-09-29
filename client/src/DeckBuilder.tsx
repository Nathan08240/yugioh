import { useEffect, useMemo, useState } from "react";
import { COPIES_MAX, countBy, deckError, EXTRA_MAX, isFusion, MAIN_MAX, MAIN_MIN, NAME_MAX, type DeckCard, type DeckDraft } from "../../server/src/deckcheck.ts";
import type { ClientMessage, Deck } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { cardName, DuelView, useCards, useDuelView } from "./cards.ts";
import { filterCollection, noFilters, type Filters, type Kind } from "./collection.ts";
import type { DeckList } from "./lobby.ts";
import "./styles/collection.css";

type Send = (msg: ClientMessage) => void;
type Props = { collection?: [number, number][]; decks?: DeckList; send: Send };

const LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);
const newDeck = (): DeckDraft => ({ name: "Nouveau deck", main: [], extra: [] });
const copy = ({ id, name, main, extra }: Deck): DeckDraft => ({ id, name, main: [...main], extra: [...extra] });
const same = (a: DeckDraft, b: Deck) => a.name === b.name && a.main.join() === b.main.join() && a.extra.join() === b.extra.join();

// Collection on the left, card detail and the edited deck on the right. The server checks every save.
export function DeckBuilder({ collection, decks, send }: Readonly<Props>) {
  const cards = useCards();
  const [shown, setShown] = useState<number>();
  const view = useMemo(() => ({ cards, show: setShown, seat: 0 }), [cards]);
  const [draft, setDraft] = useState<DeckDraft>();

  // Once per visit of the screen: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "collection" });
    send({ type: "decks" });
  }, []);

  // A fresh deck list shows the deck just saved, else the one being edited, else the active one.
  useEffect(() => {
    if (!decks) return;
    setDraft((current) => {
      const id = decks.saved ?? current?.id;
      const deck = decks.decks.find((candidate) => candidate.id === id) ?? decks.decks.find((candidate) => candidate.id === decks.active);
      return deck && copy(deck);
    });
  }, [decks]);

  if (!collection || !decks || cards.size === 0) return <p className="ecran-message">Chargement de la collection…</p>;
  return (
    <DuelView value={view}>
      <div className="builder ancien">
        <CollectionPanel collection={collection} draft={draft} onAdd={(code) => draft && setDraft(add(draft, code, cards.get(code)))} />
        <aside className="side">
          <CardDetail code={shown} />
          <DeckPanel decks={decks} draft={draft} owned={collection} setDraft={setDraft} send={send} />
        </aside>
      </div>
    </DuelView>
  );
}

function add(draft: DeckDraft, code: number, card: DeckCard | undefined): DeckDraft {
  if (card && isFusion(card)) return { ...draft, extra: [...draft.extra, code] };
  return { ...draft, main: [...draft.main, code] };
}

function removeOne(codes: number[], code: number): number[] {
  const index = codes.lastIndexOf(code);
  return index === -1 ? codes : codes.toSpliced(index, 1);
}

type CollectionProps = { collection: [number, number][]; draft?: DeckDraft; onAdd: (code: number) => void };

function CollectionPanel({ collection, draft, onAdd }: Readonly<CollectionProps>) {
  const { cards, show } = useDuelView();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const shownCards = useMemo(() => filterCollection(collection, cards, filters), [collection, cards, filters]);
  const used = countBy(draft ? [...draft.main, ...draft.extra] : []);
  const total = collection.reduce((sum, [, quantity]) => sum + quantity, 0);

  return (
    <section className="stack">
      <FilterBar filters={filters} onChange={setFilters} />
      <p className="muted">
        {shownCards.length} cartes affichées · {total} cartes possédées. Cliquez sur une carte pour l'ajouter au deck.
      </p>
      <ul className="collection-grid">
        {shownCards.map(([code, quantity]) => {
          const inDeck = used.get(code) ?? 0;
          const spent = !draft || inDeck >= quantity;
          return (
            <li key={code}>
              <button
                type="button"
                className={spent ? "owned spent" : "owned"}
                aria-label={`${cardName(cards, code)} : ${inDeck} dans le deck sur ${quantity} possédées`}
                // Not `disabled`: a disabled button gets no hover, and the detail must still show.
                aria-disabled={spent}
                onMouseEnter={() => show(code)}
                onFocus={() => show(code)}
                onClick={() => {
                  if (!spent) onAdd(code);
                }}
              >
                <CardView code={code} />
                <span className="owned-count">
                  {inDeck} / {quantity}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FilterBar({ filters, onChange }: Readonly<{ filters: Filters; onChange: (filters: Filters) => void }>) {
  const { cards } = useDuelView();
  // The attributes of the pool in engine order, named by the server.
  const attributes = useMemo(
    () => [...new Map([...cards.values()].map((card) => [card.attribute, card.attributeName]))].filter(([value]) => value).sort(([a], [b]) => a - b),
    [cards],
  );
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="filters">
      <input type="search" placeholder="Rechercher par nom" aria-label="Rechercher par nom" value={filters.name} onChange={(event) => set({ name: event.target.value })} />
      <select aria-label="Type" value={filters.kind} onChange={(event) => set({ kind: event.target.value as Kind })}>
        <option value="">Tous les types</option>
        <option value="monster">Monstres</option>
        <option value="spell">Magies</option>
        <option value="trap">Pièges</option>
      </select>
      <select aria-label="Attribut" value={filters.attribute} onChange={(event) => set({ attribute: Number(event.target.value) })}>
        <option value={0}>Tous les attributs</option>
        {attributes.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select aria-label="Niveau" value={filters.level} onChange={(event) => set({ level: Number(event.target.value) })}>
        <option value={0}>Tous les niveaux</option>
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            Niveau {level}
          </option>
        ))}
      </select>
      <Range label="ATK" value={filters.atk} onChange={(atk) => set({ atk })} />
      <Range label="DEF" value={filters.def} onChange={(def) => set({ def })} />
      <button type="button" className="link" onClick={() => onChange(noFilters)}>
        Réinitialiser
      </button>
    </div>
  );
}

type RangeProps = { label: string; value: [string, string]; onChange: (value: [string, string]) => void };

function Range({ label, value: [min, max], onChange }: Readonly<RangeProps>) {
  return (
    <div className="range" role="group" aria-label={label}>
      <span>{label}</span>
      <input type="number" min={0} step={100} placeholder="min" aria-label={`${label} minimum`} value={min} onChange={(event) => onChange([event.target.value, max])} />
      <input type="number" min={0} step={100} placeholder="max" aria-label={`${label} maximum`} value={max} onChange={(event) => onChange([min, event.target.value])} />
    </div>
  );
}

type DeckPanelProps = { decks: DeckList; draft?: DeckDraft; owned: [number, number][]; setDraft: (draft: DeckDraft) => void; send: Send };

function DeckPanel({ decks, draft, owned, setDraft, send }: Readonly<DeckPanelProps>) {
  const { cards } = useDuelView();
  const ownedMap = useMemo(() => new Map(owned), [owned]);
  const choose = (value: string) => {
    const deck = decks.decks.find((candidate) => String(candidate.id) === value);
    setDraft(deck ? copy(deck) : newDeck());
  };

  return (
    <section className="deck-panel stack">
      <div className="row">
        <select aria-label="Deck" value={draft?.id ?? "new"} onChange={(event) => choose(event.target.value)}>
          {decks.decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name}
              {deck.id === decks.active ? " (actif)" : ""}
            </option>
          ))}
          {draft && draft.id === undefined && <option value="new">{draft.name || "Nouveau deck"} (non enregistré)</option>}
        </select>
        <button type="button" className="secondary" onClick={() => setDraft(newDeck())}>
          Nouveau
        </button>
      </div>
      {draft && <DeckEditor key={draft.id ?? "new"} decks={decks} draft={draft} error={deckError(draft, (code) => cards.get(code), ownedMap)} setDraft={setDraft} send={send} />}
    </section>
  );
}

type EditorProps = { decks: DeckList; draft: DeckDraft; error?: string; setDraft: (draft: DeckDraft) => void; send: Send };

function DeckEditor({ decks, draft, error, setDraft, send }: Readonly<EditorProps>) {
  const saved = decks.decks.find((deck) => deck.id === draft.id);
  const dirty = !saved || !same(draft, saved);
  const active = draft.id !== undefined && draft.id === decks.active;
  // A first click asks for confirmation, the second one deletes.
  const [confirming, setConfirming] = useState(false);
  const remove = () => {
    if (saved && confirming) send({ type: "delete_deck", id: saved.id });
    setConfirming(!confirming);
  };

  return (
    <>
      <label>
        Nom du deck
        <input value={draft.name} maxLength={NAME_MAX} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <div className="counts">
        <Count label="Main deck" count={draft.main.length} ok={draft.main.length >= MAIN_MIN && draft.main.length <= MAIN_MAX} rule={`${MAIN_MIN} à ${MAIN_MAX}`} />
        <Count label="Extra deck" count={draft.extra.length} ok={draft.extra.length <= EXTRA_MAX} rule={`${EXTRA_MAX} max, fusions`} />
      </div>
      <p className={error ? "rule bad" : "rule muted"}>{error ?? `Deck valide. ${COPIES_MAX} exemplaires au plus d'une même carte.`}</p>
      <div className="actions">
        <button type="button" disabled={Boolean(error) || !dirty} onClick={() => send({ type: "save_deck", deck: draft })}>
          Enregistrer
        </button>
        <button type="button" className="secondary" disabled={!saved || dirty || active} onClick={() => saved && send({ type: "active_deck", id: saved.id })}>
          {active ? "Deck actif" : "Utiliser en duel"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!saved || active}
          title={active ? "Choisissez un autre deck actif avant de supprimer celui-ci" : undefined}
          onClick={remove}
        >
          {confirming ? "Confirmer la suppression" : "Supprimer"}
        </button>
      </div>
      <DeckCards title="Main deck" codes={draft.main} onRemove={(code) => setDraft({ ...draft, main: removeOne(draft.main, code) })} />
      <DeckCards title="Extra deck" codes={draft.extra} onRemove={(code) => setDraft({ ...draft, extra: removeOne(draft.extra, code) })} />
    </>
  );
}

function Count({ label, count, ok, rule }: Readonly<{ label: string; count: number; ok: boolean; rule: string }>) {
  return (
    <div className={ok ? "count" : "count bad"}>
      <span>{label}</span>
      <strong>{count}</strong>
      <span className="muted">{rule}</span>
    </div>
  );
}

// One line per card with its number of copies; a click removes one copy.
function DeckCards({ title, codes, onRemove }: Readonly<{ title: string; codes: number[]; onRemove: (code: number) => void }>) {
  const { cards, show } = useDuelView();
  const lines = [...countBy(codes)].sort(([a], [b]) => cardName(cards, a).localeCompare(cardName(cards, b)));
  return (
    <div className="stack deck-cards">
      <h3>{title}</h3>
      {lines.length === 0 && <p className="muted">Aucune carte.</p>}
      <ul className="deck-list">
        {lines.map(([code, copies]) => (
          <li key={code}>
            <button type="button" className="deck-line" title="Retirer un exemplaire" onMouseEnter={() => show(code)} onFocus={() => show(code)} onClick={() => onRemove(code)}>
              <span className="copies">{copies}×</span> {cardName(cards, code)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
