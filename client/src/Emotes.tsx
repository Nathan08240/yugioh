import { useEffect, useRef, useState } from "react";
import { EMOTE_DELAY, EMOTES, type EmoteId } from "../../server/src/emotes.ts";
import type { ShownEmote } from "./lobby.ts";

const TEXTES = new Map<EmoteId, string>(EMOTES);
// How long a bubble stays up.
const DUREE = 4000;

// The phrase an emote sends, in a bubble beside the sender's plate. The live region is always there so the phrase is announced.
export function Emote({ emote }: Readonly<{ emote?: ShownEmote }>) {
  const [masquee, setMasquee] = useState<number>();
  useEffect(() => {
    if (!emote) return;
    const timer = setTimeout(() => setMasquee(emote.n), DUREE);
    return () => clearTimeout(timer);
  }, [emote]);
  const texte = emote && emote.n !== masquee ? TEXTES.get(emote.id) : undefined;
  return (
    <p className="emote" aria-live="polite">
      {texte}
    </p>
  );
}

// A button that opens the list of phrases: Escape or a press elsewhere closes it. After one is sent, the phrases wait EMOTE_DELAY, as the server does.
export function MenuEmotes({ send }: Readonly<{ send: (id: EmoteId) => void }>) {
  const [ouvert, setOuvert] = useState(false);
  const [attente, setAttente] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    racine.current?.querySelector<HTMLButtonElement>("ul button:not(:disabled)")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOuvert(false);
      bouton.current?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (!racine.current?.contains(event.target as Node)) setOuvert(false);
    };
    // Capture phase and stopPropagation: Escape closes only the list.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [ouvert]);
  useEffect(() => {
    if (!attente) return;
    const timer = setTimeout(() => setAttente(false), EMOTE_DELAY);
    return () => clearTimeout(timer);
  }, [attente]);
  const choisir = (id: EmoteId) => {
    send(id);
    setAttente(true);
    setOuvert(false);
    bouton.current?.focus();
  };
  return (
    <div className="emotes" ref={racine}>
      <button ref={bouton} type="button" className="btn btn--fantome emotes__bouton" aria-expanded={ouvert} aria-controls="emotes-liste" onClick={() => setOuvert(!ouvert)}>
        Émotes
      </button>
      {ouvert && (
        <ul id="emotes-liste" className="panneau emotes__liste" aria-label="Phrases à envoyer">
          {EMOTES.map(([id, texte]) => (
            <li key={id}>
              <button type="button" className="btn btn--fantome" disabled={attente} onClick={() => choisir(id)}>
                {texte}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
