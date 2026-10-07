import { useState } from "react";
import { NAME_MAX } from "../../server/src/deckcheck.ts";
import { DESCRIPTION_MAX, type ClientMessage, type Deck } from "../../server/src/protocol.ts";
import { deckLink } from "./lobby.ts";
import "./styles/decks-publics.css";
import { Icon } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

// In the deck builder: shares the saved deck by code, or publishes it. The server keeps a copy of the saved deck, hence `dirty`.
export function PartageDeck({ deck, dirty, send }: Readonly<{ deck: Deck; dirty: boolean; send: Send }>) {
  const [publishing, setPublishing] = useState(false);
  const title = dirty ? "Enregistrez le deck avant de le partager" : undefined;
  return (
    <section className="deck-partage" aria-label="Partage du deck">
      <div className="deck-actions">
        <button type="button" className="btn btn--fantome" disabled={dirty} title={title} onClick={() => send({ type: "deck_share", id: deck.id })}>
          <Icon id="ui-copier" />
          Partager
        </button>
        <button type="button" className="btn btn--fantome" disabled={dirty} title={title} aria-expanded={publishing} onClick={() => setPublishing(!publishing)}>
          Publier
        </button>
      </div>
      {publishing && !dirty && (
        <form
          className="deck-partage__form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            send({ type: "deck_publish", id: deck.id, name: String(data.get("name")), description: String(data.get("description")) });
            setPublishing(false);
          }}
        >
          <label className="champ">
            Nom affiché
            <span className="champ__saisie">
              <input name="name" required maxLength={NAME_MAX} defaultValue={deck.name} />
            </span>
          </label>
          <label className="champ">
            Description (facultative)
            <textarea name="description" rows={3} maxLength={DESCRIPTION_MAX} />
          </label>
          <p className="texte-3">Tout le monde pourra voir ce deck et le copier. Vous pouvez le retirer à tout moment.</p>
          <button type="submit" className="btn">
            Publier ce deck
          </button>
        </form>
      )}
    </section>
  );
}

function CodeBoite({ shared, close }: Readonly<{ shared: { code: string; published: boolean }; close: () => void }>) {
  const [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState(false);
  const link = deckLink(location.origin, shared.code);
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(done),
      () => {
        setCopied("");
        setFallback(true);
      },
    );
  };
  return (
    <div className="apercu-salle panneau" role="alertdialog" aria-label="Code du deck">
      <p>{shared.published ? "Deck publié dans Decks publics." : "Deck partagé."} Donnez ce code ou ce lien :</p>
      <p className="decks-code chiffres">{shared.code}</p>
      <div className="alerte-ami__actions">
        <button type="button" className="btn btn--holo" onClick={() => copy(shared.code, "Code copié.")}>
          <Icon id="ui-copier" />
          Copier le code
        </button>
        <button type="button" className="btn btn--holo" onClick={() => copy(link, "Lien copié.")}>
          <Icon id="ui-copier" />
          Copier le lien
        </button>
        <button type="button" className="btn btn--fantome" onClick={close}>
          Fermer
        </button>
      </div>
      {fallback && <input className="saisie-code" readOnly value={link} aria-label="Lien du deck" onFocus={(event) => event.currentTarget.select()} />}
      <p className={copied ? "message message--succes" : "sr"} role="status">
        {copied}
      </p>
    </div>
  );
}

// The code just given for a deck shared or published, over any screen.
export function CodeDeck({ shared, close }: Readonly<{ shared?: { code: string; published: boolean }; close: () => void }>) {
  if (!shared) return null;
  return <CodeBoite key={shared.code} shared={shared} close={close} />;
}
