import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { COPIES_MAX, countBy, deckError, EXTRA_MAX, isFusion, MAIN_MAX, MAIN_MIN, NAME_MAX, type DeckCard, type DeckDraft } from "../../server/src/deckcheck.ts";
import suggested from "../../server/data/suggested-decks.json";
import type { ClientMessage, Deck, DeckResult } from "../../server/src/protocol.ts";
import { CardDetail, CardView } from "./Card.tsx";
import { Constructeur } from "./Constructeur.tsx";
import { DeckRecord } from "./DeckRecord.tsx";
import { GoatStatus, goatCompliant } from "./goat.tsx";
import { attributeKey, cardName, DuelView, frame, useCards, useDuelView } from "./cards.ts";
import { drawHand, fitSuggestion, formatYdk, importDeck, parseYdk, type Skipped, type Suggestion } from "./deckTools.ts";
import { bestRarity, copiesByRarity, filterCollection, kindCounts, noFilters, type Copies, type Filters, type Kind } from "./collection.ts";
import type { DeckList } from "./lobby.ts";
import { D2, D3, duree, ELAN, FONDU, prefersReduced, RESSORT, SORTIE, type AnimOptions } from "./motion.ts";
import "./styles/collection.css";
import { BestRarity, FermerFiche, Icon } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;
type SetDraft = Dispatch<SetStateAction<DeckDraft | undefined>>;
type Props = { collection?: [number, number][]; rarities?: [number, string, number][]; decks?: DeckList; results?: DeckResult[]; send: Send };

const LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);
const KINDS: [Kind, string][] = [
  ["", "Toutes"],
  ["monster", "Monstres"],
  ["spell", "Magies"],
  ["trap", "Pièges"],
  ["fusion", "Fusions"],
];
const SUGGESTIONS = suggested as Suggestion[];
const newDeck = (): DeckDraft => ({ name: "Nouveau deck", main: [], extra: [] });
const copy = ({ id, name, main, extra }: Deck): DeckDraft => ({ id, name, main: [...main], extra: [...extra] });
const same = (a: DeckDraft, b: Deck) => a.name === b.name && a.main.join() === b.main.join() && a.extra.join() === b.extra.join();
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

// Collection on the left, card detail in the middle, the edited deck on the right. The server checks every save.
export function DeckBuilder({ collection, rarities, decks, results, send }: Readonly<Props>) {
  const cards = useCards();
  const [shown, setShown] = useState<number>();
  // On a phone the detail opens full screen (cartes.css .fiche).
  const [fiche, setFiche] = useState(false);
  const view = useMemo(() => {
    const ouvrir = (code: number) => {
      setShown(code);
      setFiche(true);
    };
    return { cards, show: setShown, seat: 0, ouvrir };
  }, [cards]);
  const [draft, setDraft] = useState<DeckDraft>();
  const copies = useMemo(() => copiesByRarity(collection ?? [], rarities ?? []), [collection, rarities]);

  // Once per visit of the screen: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "collection" });
    send({ type: "decks" });
    send({ type: "duel_results" });
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
      <div className="atelier">
        <CollectionPanel collection={collection} copies={copies} draft={draft} onAdd={(code) => draft && setDraft(add(draft, code, cards.get(code)))} onCreate={setDraft} />
        <aside className={fiche ? "panneau fiche atelier__detail est-ouverte" : "panneau fiche atelier__detail"} aria-label="Détail de la carte" data-entree>
          <FermerFiche fermer={() => setFiche(false)} />
          <CardDetail code={shown} copies={shown === undefined ? undefined : copies.get(shown)} />
        </aside>
        <DeckPanel decks={decks} results={results} draft={draft} owned={collection} setDraft={setDraft} send={send} />
      </div>
    </DuelView>
  );
}

export function add(draft: DeckDraft, code: number, card: DeckCard | undefined): DeckDraft {
  if (card && isFusion(card)) return { ...draft, extra: [...draft.extra, code] };
  return { ...draft, main: [...draft.main, code] };
}

function removeOne(codes: number[], code: number): number[] {
  const index = codes.lastIndexOf(code);
  return index === -1 ? codes : codes.toSpliced(index, 1);
}

// Plays at once, outside the duel queue; with reduced motion only the opacity changes, in a 150 ms fade.
function play(el: Element | null | undefined, keyframes: Keyframe[], options: AnimOptions): Promise<void> {
  if (!el) return Promise.resolve();
  const reduced = prefersReduced();
  const fade = keyframes.map(({ opacity }) => opacity).filter((value) => value !== undefined);
  if (reduced && fade.length < 2) return Promise.resolve();
  const animation = reduced ? el.animate(fade.map((opacity) => ({ opacity })), { duration: duree(FONDU), fill: options.fill }) : el.animate(keyframes, { ...options, duration: duree(options.duration ?? D3) });
  return animation.finished.then(
    () => {},
    () => {},
  );
}

const ENTER: Keyframe[] = [
  { opacity: 0, translate: "-16px 0", scale: "0.96" },
  { opacity: 1, translate: "0 0", scale: "1" },
];
const POP: Keyframe[] = [{ scale: "1.4" }, { scale: "1" }];
const LEAVE: Keyframe[] = [
  { opacity: 1, translate: "0 0" },
  { opacity: 0, translate: "24px 0" },
];

// `suggest`: offers the suggested decks, which the Sealed reserve cannot follow.
type CollectionProps = { collection: [number, number][]; copies: ReadonlyMap<number, Copies>; draft?: DeckDraft; onAdd: (code: number) => void; onCreate: (draft: DeckDraft) => void; suggest?: boolean };

export function CollectionPanel({ collection, copies, draft, onAdd, onCreate, suggest = true }: Readonly<CollectionProps>) {
  const { cards, show, ouvrir } = useDuelView();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const shownCards = useMemo(() => filterCollection(collection, cards, filters), [collection, cards, filters]);
  const used = countBy(draft ? [...draft.main, ...draft.extra] : []);
  const total = collection.reduce((sum, [, quantity]) => sum + quantity, 0);

  return (
    <section className="atelier__collection" aria-label="Collection" data-entree>
      {suggest && <Suggestions collection={collection} onCreate={onCreate} />}
      <Constructeur collection={collection} draft={draft} onCreate={onCreate} />
      <FilterBar filters={filters} onChange={setFilters} />
      <p className="texte-3 atelier__resume">
        {shownCards.length} cartes affichées · {total} possédées · cliquez sur une carte pour l'ajouter au deck
      </p>
      {shownCards.length === 0 && (
        <p className="atelier__vide">
          Aucune carte ne correspond à ces filtres.{" "}
          <button type="button" className="lien" onClick={() => setFilters(noFilters)}>
            Réinitialiser les filtres
          </button>
        </p>
      )}
      <ul className="grille-collection">
        {shownCards.map(([code, quantity]) => {
          const inDeck = used.get(code) ?? 0;
          const spent = !draft || inDeck >= quantity;
          return (
            <li key={code} className={spent ? "est-epuisee" : undefined}>
              <button
                type="button"
                aria-label={`${cardName(cards, code)} : ${inDeck} dans le deck sur ${quantity} possédées`}
                // Not `disabled`: a disabled button gets no hover, and the detail must still show.
                aria-disabled={spent}
                onMouseEnter={() => show(code)}
                onFocus={() => show(code)}
                onClick={() => {
                  if (!spent) onAdd(code);
                }}
              >
                <CardView code={code} rarity={bestRarity(copies.get(code))} />
              </button>
              {ouvrir && (
                <button type="button" className="voir-carte" aria-label={`Voir ${cardName(cards, code)}`} onClick={() => ouvrir(code)}>
                  <Icon id="ui-oeil" />
                </button>
              )}
              <BestRarity copies={copies.get(code)} />
              <span className="qte" aria-hidden="true">
                ×{quantity}
              </span>
              {inDeck > 0 && (
                <span className="dans-deck" aria-hidden="true">
                  {inDeck}/{quantity}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SuggestionsProps = { collection: [number, number][]; onCreate: (draft: DeckDraft) => void };

const sum = (pairs: [number, number, ...unknown[]][]) => pairs.reduce((total, [, copies]) => total + copies, 0);

// Ready-made lists from the pool: how many cards the player owns, the missing ones, and a new draft with the owned part.
function Suggestions({ collection, onCreate }: Readonly<SuggestionsProps>) {
  const { cards } = useDuelView();
  const owned = useMemo(() => new Map(collection), [collection]);
  const fits = useMemo(() => SUGGESTIONS.map((suggestion) => fitSuggestion(suggestion, (code) => cards.get(code), owned)), [cards, owned]);
  return (
    <details className="suggestions">
      <summary>Decks suggérés</summary>
      <ul className="suggestions__liste">
        {SUGGESTIONS.map(({ id, title, description, main, extra }, index) => {
          const { main: ownedMain, extra: ownedExtra, missing } = fits[index];
          return (
            <li key={id} className="suggestions__deck">
              <strong>{title}</strong>
              <p className="texte-3">{description}</p>
              <p className="suggestions__compte">
                {ownedMain.length + ownedExtra.length} / {sum([...main, ...extra])} cartes possédées
              </p>
              {missing.length > 0 && (
                <details>
                  <summary>Cartes manquantes ({sum(missing)})</summary>
                  <p className="texte-3">{missing.map(([code, copies]) => `${cardName(cards, code)} ×${copies}`).join(", ")}</p>
                </details>
              )}
              <button type="button" className="btn btn--fantome" onClick={() => onCreate({ name: title, main: ownedMain, extra: ownedExtra })}>
                Créer ce deck
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function FilterBar({ filters, onChange }: Readonly<{ filters: Filters; onChange: (filters: Filters) => void }>) {
  const { cards } = useDuelView();
  // The attributes of the pool in engine order, named by the server.
  const attributes = useMemo(
    () => [...new Map([...cards.values()].map((card) => [card.attribute, card.attributeName]))].filter(([value]) => attributeKey(value)).sort(([a], [b]) => a - b),
    [cards],
  );
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const changed = JSON.stringify(filters) !== JSON.stringify(noFilters);
  return (
    <div className="filtres">
      <label className="champ__saisie filtres__recherche">
        <Icon id="ui-recherche" />
        <span className="sr">Rechercher par nom</span>
        <input type="search" placeholder="Rechercher par nom…" value={filters.name} onChange={(event) => set({ name: event.target.value })} />
      </label>
      <label className="filtres__texte">
        <input type="checkbox" checked={filters.text} onChange={(event) => set({ text: event.target.checked })} />
        Chercher aussi dans le texte
      </label>
      <div className="segments" role="group" aria-label="Genre de carte">
        {KINDS.map(([kind, label]) => (
          <button key={kind} type="button" aria-pressed={filters.kind === kind} onClick={() => set({ kind })}>
            {label}
          </button>
        ))}
      </div>
      <div className="attributs" role="group" aria-label="Attribut">
        {attributes.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`a-${attributeKey(value)}`}
            aria-label={label}
            title={label}
            aria-pressed={filters.attribute === value}
            onClick={() => set({ attribute: filters.attribute === value ? 0 : value })}
          >
            <Icon id={`attr-${attributeKey(value)}`} />
          </button>
        ))}
      </div>
      <label className="choix">
        <span className="sr">Niveau</span>
        <select value={filters.level} onChange={(event) => set({ level: Number(event.target.value) })}>
          <option value={0}>Tous niveaux</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              Niveau {level}
            </option>
          ))}
        </select>
      </label>
      <Range label="ATK" value={filters.atk} onChange={(atk) => set({ atk })} />
      <Range label="DEF" value={filters.def} onChange={(def) => set({ def })} />
      {changed && (
        <button type="button" className="lien" onClick={() => onChange(noFilters)}>
          Réinitialiser
        </button>
      )}
    </div>
  );
}

type RangeProps = { label: string; value: [string, string]; onChange: (value: [string, string]) => void };

function Range({ label, value: [min, max], onChange }: Readonly<RangeProps>) {
  return (
    <div className="plage" role="group" aria-label={label}>
      <span>{label}</span>
      <input type="number" min={0} step={100} placeholder="min" aria-label={`${label} minimum`} value={min} onChange={(event) => onChange([event.target.value, max])} />
      <span aria-hidden="true">–</span>
      <input type="number" min={0} step={100} placeholder="max" aria-label={`${label} maximum`} value={max} onChange={(event) => onChange([min, event.target.value])} />
    </div>
  );
}

type DeckPanelProps = { decks: DeckList; results?: DeckResult[]; draft?: DeckDraft; owned: [number, number][]; setDraft: SetDraft; send: Send };

function DeckPanel({ decks, results, draft, owned, setDraft, send }: Readonly<DeckPanelProps>) {
  const { cards } = useDuelView();
  const ownedMap = useMemo(() => new Map(owned), [owned]);

  return (
    <aside className="panneau atelier__deck" aria-label="Deck en cours" data-entree>
      {draft ? (
        <DeckEditor key={draft.id ?? "new"} decks={decks} results={results} draft={draft} error={deckError(draft, (code) => cards.get(code), ownedMap)} owned={ownedMap} setDraft={setDraft} send={send} />
      ) : (
        <>
          <p className="texte-2">Aucun deck pour l'instant.</p>
          <button type="button" className="btn" onClick={() => setDraft(newDeck())}>
            Nouveau deck
          </button>
        </>
      )}
    </aside>
  );
}

type EditorProps = { decks: DeckList; results?: DeckResult[]; draft: DeckDraft; error?: string; owned: ReadonlyMap<number, number>; setDraft: SetDraft; send: Send };

function DeckEditor({ decks, results, draft, error, owned, setDraft, send }: Readonly<EditorProps>) {
  const { cards } = useDuelView();
  const saved = decks.decks.find((deck) => deck.id === draft.id);
  const dirty = !saved || !same(draft, saved);
  const active = draft.id !== undefined && draft.id === decks.active;
  // A first click asks for confirmation, the second one deletes.
  const [confirming, setConfirming] = useState(false);
  const remove = () => {
    if (saved && confirming) send({ type: "delete_deck", id: saved.id });
    setConfirming(!confirming);
  };
  const choose = (value: string) => {
    const deck = decks.decks.find((candidate) => String(candidate.id) === value);
    setDraft(deck ? copy(deck) : newDeck());
  };
  const kinds = kindCounts(draft.main, cards);
  const breakdown = [plural(kinds.monster, "monstre"), plural(kinds.spell, "magie"), plural(kinds.trap, "piège")];

  return (
    <>
      <div className="deck-tete">
        <label className="choix">
          <span className="sr">Deck</span>
          <select value={draft.id ?? "new"} onChange={(event) => choose(event.target.value)}>
            {decks.decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
                {deck.id === decks.active ? " (actif)" : ""}
              </option>
            ))}
            {draft.id === undefined && <option value="new">{draft.name || "Nouveau deck"} (non enregistré)</option>}
          </select>
        </label>
        {active && <span className="puce puce--holo">Deck actif</span>}
        {saved && !active && (
          <button
            type="button"
            className="btn btn--holo"
            disabled={dirty}
            title={dirty ? "Enregistrez le deck avant de l'utiliser en duel" : undefined}
            onClick={() => saved && send({ type: "active_deck", id: saved.id })}
          >
            Utiliser en duel
          </button>
        )}
      </div>
      {saved && <DeckRecord results={results} deck={saved.id} />}
      <label className="champ">
        Nom du deck
        <span className="champ__saisie">
          <input value={draft.name} maxLength={NAME_MAX} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </span>
      </label>
      <div className="deck-compteurs">
        <Count label="Principal" rule={`${MAIN_MIN} à ${MAIN_MAX}`} count={draft.main.length} ok={draft.main.length >= MAIN_MIN && draft.main.length <= MAIN_MAX} />
        <Count label="Extra" rule={`${EXTRA_MAX} max.`} count={draft.extra.length} ok={draft.extra.length <= EXTRA_MAX} />
      </div>
      {draft.main.length > 0 && (
        <>
          <div className="repartition" role="img" aria-label={breakdown.join(", ")}>
            <span className="repartition--monstre" style={{ "--n": kinds.monster } as CSSProperties} />
            <span className="repartition--magie" style={{ "--n": kinds.spell } as CSSProperties} />
            <span className="repartition--piege" style={{ "--n": kinds.trap } as CSSProperties} />
          </div>
          <p className="repartition__legende" aria-hidden="true">
            {breakdown.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </p>
        </>
      )}
      <DeckLines draft={draft} setDraft={setDraft} />
      <p className={error ? "message message--erreur" : "message message--succes"} role="status">
        {error ?? "Deck valide : il peut servir en duel."}
      </p>
      <GoatStatus deck={draft} cards={cards} fix={() => setDraft({ ...draft, ...goatCompliant(draft, cards, new Map(owned)) })} />
      <div className="deck-actions">
        <button type="button" className="btn" disabled={Boolean(error) || !dirty} onClick={() => send({ type: "save_deck", deck: draft })}>
          {dirty ? "Enregistrer" : "Enregistré"}
        </button>
        <button type="button" className="btn btn--fantome" onClick={() => setDraft(newDeck())}>
          Nouveau deck
        </button>
      </div>
      <DeckTools draft={draft} owned={owned} setDraft={setDraft} />
      {saved && (
        <button
          type="button"
          className="lien deck-supprimer"
          disabled={active}
          title={active ? "Choisissez un autre deck actif avant de supprimer celui-ci" : undefined}
          onClick={remove}
        >
          {confirming ? "Confirmer la suppression" : "Supprimer ce deck"}
        </button>
      )}
    </>
  );
}

type ToolsProps = { draft: DeckDraft; owned: ReadonlyMap<number, number>; setDraft: SetDraft };

// Export and import (.ydk, EDOPro), and a hand of five cards drawn from the main deck.
function DeckTools({ draft, owned, setDraft }: Readonly<ToolsProps>) {
  const { cards } = useDuelView();
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<{ imported: number; skipped: Skipped[]; invalid: string[] }>();
  const [hand, setHand] = useState<number[]>();
  const [copied, setCopied] = useState(false);
  const ydk = () => formatYdk(draft);

  const download = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ydk()], { type: "text/plain" }));
    link.download = `${draft.name.trim() || "deck"}.ydk`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const copyText = async () => {
    await navigator.clipboard.writeText(ydk()).then(() => setCopied(true), () => setCopied(false));
    setTimeout(() => setCopied(false), 2000);
  };
  const load = (text: string) => {
    const parsed = parseYdk(text);
    const { main, extra, skipped } = importDeck(parsed, (code) => cards.get(code), owned);
    setDraft((current) => (current && current.id === draft.id ? { ...current, main, extra } : current));
    setReport({ imported: main.length + extra.length, skipped, invalid: parsed.invalid });
  };
  const readFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (file) load(await file.text());
  };
  const lost = [...(report?.skipped.map(({ code, reason }) => `${cardName(cards, code)} (${reason})`) ?? []), ...(report?.invalid.map((line) => `« ${line} » (ligne invalide)`) ?? [])];

  return (
    <section className="deck-outils" aria-label="Outils du deck">
      <div className="deck-actions">
        <button type="button" className="btn btn--fantome" onClick={download}>
          Exporter (.ydk)
        </button>
        <button type="button" className="btn btn--fantome" onClick={copyText}>
          {copied ? "Copié" : "Copier le texte"}
        </button>
      </div>
      <details>
        <summary>Importer un deck</summary>
        <label className="champ">
          Fichier .ydk
          <input type="file" accept=".ydk,text/plain" onChange={(event) => readFile(event.target)} />
        </label>
        <label className="champ">
          Ou coller la liste
          <textarea rows={4} value={pasted} onChange={(event) => setPasted(event.target.value)} />
        </label>
        <button type="button" className="btn" disabled={pasted.trim() === ""} onClick={() => load(pasted)}>
          Importer le texte
        </button>
        {report && (
          <p className={lost.length > 0 ? "message message--erreur" : "message message--succes"} role="status">
            Cartes importées : {report.imported}.{lost.length > 0 && ` Écartées : ${lost.join(", ")}.`}
          </p>
        )}
      </details>
      <button
        type="button"
        className="btn btn--fantome"
        disabled={draft.main.length === 0}
        onClick={() => setHand(drawHand(draft.main))}
      >
        {hand ? "Nouvelle main" : "Main de test"}
      </button>
      {hand && (
        <ul className="main-test" aria-label="Main de test">
          {hand.map((code, index) => (
            <li key={`${code}-${hand.slice(0, index).filter((other) => other === code).length}`}>
              <CardView code={code} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Count({ label, rule, count, ok }: Readonly<{ label: string; rule: string; count: number; ok: boolean }>) {
  return (
    <p className={ok ? undefined : "est-hors-regle"}>
      <span className="chiffres">{count}</span>
      <span>
        {label}
        <br />
        {rule}
      </span>
    </p>
  );
}

type Line = [code: number, copies: number, extra: boolean];

// Main deck then Extra deck, one line per card with its copies. A new line slides in, a changed count pops, a last copy slides out.
export function DeckLines({ draft, setDraft }: Readonly<{ draft: DeckDraft; setDraft: SetDraft }>) {
  const { cards, show, ouvrir } = useDuelView();
  const list = useRef<HTMLUListElement>(null);
  const previous = useRef<Map<number, number>>(undefined);
  const sorted = (codes: number[], extra: boolean): Line[] =>
    [...countBy(codes)].map(([code, copies]): Line => [code, copies, extra]).sort(([a], [b]) => cardName(cards, a).localeCompare(cardName(cards, b)));
  const lines = [...sorted(draft.main, false), ...sorted(draft.extra, true)];
  const lineOf = (code: number) => list.current?.querySelector(`[data-code="${code}"]`);

  useLayoutEffect(() => {
    const before = previous.current;
    const now = countBy([...draft.main, ...draft.extra]);
    previous.current = now;
    if (!before) return;
    for (const [code, copies] of now) {
      if (copies === before.get(code)) continue;
      const line = lineOf(code);
      if (before.has(code)) {
        play(line?.querySelector("b"), POP, { duration: D2, easing: RESSORT });
      } else {
        line?.scrollIntoView({ block: "nearest" });
        play(line, ENTER, { duration: D3, easing: SORTIE });
      }
    }
  }, [draft]);

  const removeCopy = async (code: number, copies: number, extra: boolean) => {
    if (copies === 1) await play(lineOf(code), LEAVE, { duration: D2, easing: ELAN, fill: "forwards" });
    const key = extra ? "extra" : "main";
    // The edited deck may have changed during the exit: the copy leaves that deck only.
    setDraft((current) => (current && current.id === draft.id ? { ...current, [key]: removeOne(current[key], code) } : current));
  };

  if (lines.length === 0) {
    return <p className="liste-deck__vide">Aucune carte. Cliquez sur une carte de la collection pour l'ajouter ({COPIES_MAX} exemplaires au plus par carte).</p>;
  }
  return (
    <ul ref={list} className="liste-deck">
      {lines.map(([code, copies, extra]) => {
        const info = cards.get(code);
        const name = cardName(cards, code);
        return (
          <li key={code} data-code={code} className={`t-${frame(info?.type ?? 0)}`}>
            {info?.image ? <img src={`/api/art/${code}.jpg`} alt="" loading="lazy" /> : <span className="liste-deck__repli" />}
            <button type="button" className="liste-deck__nom" title="Voir la carte" onMouseEnter={() => show(code)} onFocus={() => show(code)} onClick={() => (ouvrir ?? show)(code)}>
              {name}
            </button>
            <b>×{copies}</b>
            <button type="button" className="btn-icone btn-icone--petit" aria-label={`Retirer un exemplaire de ${name}`} onClick={() => removeCopy(code, copies, extra)}>
              <Icon id="ui-moins" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
