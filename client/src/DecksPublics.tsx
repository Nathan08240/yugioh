import { useEffect, useMemo, useState } from "react";
import { countBy } from "../../server/src/deckcheck.ts";
import type { ClientMessage, PublicDeck, PublicSort, SharedDeck } from "../../server/src/protocol.ts";
import { thumbSmall } from "./art.ts";
import { cardName, frame, useDuelView } from "./cards.ts";
import { deckLink, type LobbyState } from "./lobby.ts";
import "./styles/decks-publics.css";
import { Icon } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const SORTS: [PublicSort, string][] = [
  ["copies", "Les plus copiés"],
  ["recent", "Les plus récents"],
];
const FORMATS: [string, string][] = [
  ["", "Tous les formats"],
  ["goat", "Conformes à la liste Goat"],
  ["hors", "Hors liste Goat"],
];
const sum = (pairs: [number, number][]) => pairs.reduce((total, [, copies]) => total + copies, 0);
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

// A first click asks for confirmation, the second one withdraws the deck.
export function Retirer({ code, send }: Readonly<{ code: string; send: Send }>) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--fantome"
      onClick={() => {
        if (confirming) send({ type: "deck_unpublish", code });
        setConfirming(!confirming);
      }}
    >
      {confirming ? "Confirmer le retrait" : "Retirer"}
    </button>
  );
}

// A card of the pool by its name, for the filter of the list.
function CarteFiltre({ code, onChange }: Readonly<{ code?: number; onChange: (code?: number) => void }>) {
  const { cards } = useDuelView();
  const [text, setText] = useState("");
  const query = text.trim().toLowerCase();
  const found = useMemo(() => {
    if (query.length < 2) return [];
    const names = new Map<string, number>();
    for (const [passcode, info] of cards) if (info.name.toLowerCase().includes(query) && !names.has(info.name)) names.set(info.name, passcode);
    return [...names].slice(0, 8);
  }, [cards, query]);
  if (code !== undefined) {
    return (
      <span className="decks-pub__carte">
        <span className="puce">Contient : {cardName(cards, code)}</span>
        <button type="button" className="lien" onClick={() => onChange(undefined)}>
          Retirer ce filtre
        </button>
      </span>
    );
  }
  return (
    <div className="decks-pub__carte">
      <label className="champ__saisie">
        <Icon id="ui-recherche" />
        <span className="sr">Contient la carte</span>
        <input type="search" placeholder="Contient la carte…" value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {found.length > 0 && (
        <ul className="decks-pub__suggestions" aria-label="Cartes trouvées">
          {found.map(([name, passcode]) => (
            <li key={passcode}>
              <button
                type="button"
                className="lien"
                onClick={() => {
                  onChange(passcode);
                  setText("");
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Resume({ deck }: Readonly<{ deck: PublicDeck }>) {
  return (
    <p className="texte-3">
      par {deck.author} · {DATE.format(new Date(deck.date))} · {plural(deck.copies, "copie")} · {plural(deck.main, "carte")}
      {deck.extra > 0 && ` + ${deck.extra} extra`}
    </p>
  );
}

type ListeProps = { decks?: PublicDeck[]; admin: boolean; send: Send };

// The public decks, one panel each; the author and the admin can withdraw one.
function Liste({ decks, admin, send }: Readonly<ListeProps>) {
  if (!decks) return <p className="texte-2">Chargement des decks publics…</p>;
  if (decks.length === 0) return <p className="texte-2">Aucun deck public ne correspond à ces filtres.</p>;
  return (
    <ul className="decks-pub__liste">
      {decks.map((deck) => (
        <li key={deck.code} className="panneau decks-pub__deck">
          <h3 className="titre-panneau">
            {deck.name} {deck.goat && <span className="puce puce--succes">Conforme Goat</span>}
          </h3>
          <Resume deck={deck} />
          {deck.description && <p className="decks-pub__description">{deck.description}</p>}
          <div className="decks-pub__actions">
            <button type="button" className="btn btn--holo" onClick={() => send({ type: "deck_view", code: deck.code })}>
              Voir le deck
            </button>
            {(deck.mine || admin) && <Retirer code={deck.code} send={send} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Line = [code: number, copies: number];

function Lignes({ codes, missing }: Readonly<{ codes: number[]; missing: ReadonlyMap<number, number> }>) {
  const { cards } = useDuelView();
  const lines: Line[] = [...countBy(codes)].sort(([a], [b]) => cardName(cards, a).localeCompare(cardName(cards, b)));
  return (
    <ul className="liste-deck decks-pub__cartes">
      {lines.map(([code, copies]) => {
        const info = cards.get(code);
        const lacking = missing.get(code) ?? 0;
        return (
          <li key={code} className={`t-${frame(info?.type ?? 0)}`}>
            {info?.image ? <img src={thumbSmall(code)} alt="" loading="lazy" decoding="async" /> : <span className="liste-deck__repli" />}
            <span className="decks-pub__nom">{cardName(cards, code)}</span>
            <b>×{copies}</b>
            <span className={lacking > 0 ? "decks-pub__manque" : "sr"}>{lacking > 0 ? `manque ×${lacking}` : "possédée"}</span>
          </li>
        );
      })}
    </ul>
  );
}

type LuProps = { deck: SharedDeck; copied: LobbyState["deckCopied"]; send: Send; close: () => void };

// A deck read from a code or from the list: what the player owns and lacks, and the copy that keeps the owned part.
function DeckLu({ deck, copied, send, close }: Readonly<LuProps>) {
  const { cards } = useDuelView();
  const [linkCopied, setLinkCopied] = useState(false);
  const missing = useMemo(() => new Map(deck.missing), [deck.missing]);
  const total = deck.main.length + deck.extra.length;
  const lacking = sum(deck.missing);
  const copyLink = () => navigator.clipboard.writeText(deckLink(location.origin, deck.code)).then(() => setLinkCopied(true), () => setLinkCopied(false));
  return (
    <section className="panneau decks-pub__lu" aria-label={`Deck ${deck.name}`} data-entree>
      <p className="surtitre">Deck partagé · code {deck.code}</p>
      <h2 className="titre-panneau">
        {deck.name} {deck.goat && <span className="puce puce--succes">Conforme Goat</span>}
      </h2>
      <p className="texte-3">
        par {deck.author} · {DATE.format(new Date(deck.date))}
        {deck.public && ` · ${plural(deck.copies, "copie")}`}
      </p>
      {deck.description && <p className="decks-pub__description">{deck.description}</p>}
      <p className={lacking > 0 ? "message message--erreur" : "message message--succes"}>
        {lacking > 0 ? `Vous possédez ${total - lacking} cartes sur ${total} : il vous en manque ${lacking}.` : `Vous possédez toutes les cartes de ce deck (${total}).`}
      </p>
      <h3 className="titre-bloc">Main deck ({deck.main.length})</h3>
      <Lignes codes={deck.main} missing={missing} />
      {deck.extra.length > 0 && (
        <>
          <h3 className="titre-bloc">Extra deck ({deck.extra.length})</h3>
          <Lignes codes={deck.extra} missing={missing} />
        </>
      )}
      <p className="texte-3">La copie ne garde que les cartes que vous possédez, et il en faut 40 au moins dans le main deck.</p>
      <div className="decks-pub__actions">
        <button type="button" className="btn btn--holo" onClick={() => send({ type: "deck_copy", code: deck.code })}>
          Copier dans mes decks
        </button>
        <button type="button" className="btn btn--fantome" onClick={copyLink}>
          <Icon id="ui-copier" />
          {linkCopied ? "Lien copié" : "Copier le lien"}
        </button>
        {deck.mine && deck.public && <Retirer code={deck.code} send={send} />}
        <button type="button" className="btn btn--fantome" onClick={close}>
          Fermer
        </button>
      </div>
      {copied && (
        <p className="message message--succes" role="status">
          Deck copié sous le nom « {copied.name} ».
          {copied.missing.length > 0 && ` Cartes laissées de côté : ${copied.missing.map(([code, copies]) => `${cardName(cards, code)} ×${copies}`).join(", ")}.`}
        </p>
      )}
    </section>
  );
}

// The code of a deck, typed or pasted.
function CodeForm({ send }: Readonly<{ send: Send }>) {
  return (
    <form
      className="decks-pub__code"
      aria-label="Ouvrir un deck avec un code"
      onSubmit={(event) => {
        event.preventDefault();
        const code = String(new FormData(event.currentTarget).get("code")).trim().toUpperCase();
        if (code) send({ type: "deck_view", code });
      }}
    >
      <label className="sr" htmlFor="deck-code">
        Code du deck
      </label>
      <input id="deck-code" name="code" className="saisie-code" required maxLength={8} placeholder="Code du deck" autoComplete="off" />
      <button type="submit" className="btn">
        Ouvrir
      </button>
    </form>
  );
}

// Public decks: the list with its filters, and the deck being read.
export function DecksPublics({ state, send, close }: Readonly<{ state: LobbyState; send: Send; close: () => void }>) {
  const [sort, setSort] = useState<PublicSort>("copies");
  const [format, setFormat] = useState("");
  const [card, setCard] = useState<number>();
  // Asked again when a filter changes, and once the deck just copied is saved: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "public_decks", sort, goat: format === "" ? undefined : format === "goat", card });
  }, [sort, format, card]);
  useEffect(() => {
    if (state.deckCopied) send({ type: "decks" });
  }, [state.deckCopied]);
  return (
    <div className="decks-pub">
      <div data-entree>
        <p className="surtitre">Decks des joueurs</p>
        <h1 className="titre">Decks publics</h1>
      </div>
      {state.sharedDeck && <DeckLu deck={state.sharedDeck} copied={state.deckCopied} send={send} close={close} />}
      <CodeForm send={send} />
      <div className="decks-pub__filtres" data-entree>
        <label className="choix">
          <span className="sr">Tri</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as PublicSort)}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="choix">
          <span className="sr">Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            {FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <CarteFiltre code={card} onChange={setCard} />
      </div>
      <Liste decks={state.publicDecks} admin={state.admin === true} send={send} />
    </div>
  );
}
