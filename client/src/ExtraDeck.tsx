import { useEffect, useLayoutEffect, useRef } from "react";
import { CardView } from "./Card.tsx";
import { cardName, useDuelView } from "./cards.ts";
import type { Listed } from "./extraDeck.ts";
import "./styles/extra.css";
import { Icon } from "./ui.tsx";

// A material and its state (a modifier of .materiaux__*), with the words that say it: colour alone never tells.
export type Item = { code: number; copies: number; etat: "ok" | "partiel" | "manque"; texte: string };

export function Materiaux({ items }: Readonly<{ items: Item[] }>) {
  const { cards, show, ouvrir } = useDuelView();
  return (
    <ul className="materiaux" aria-label="Matériaux">
      {items.map(({ code, copies, etat, texte }) => (
        <li key={code} className={`materiaux__${etat}`}>
          <button type="button" className="materiaux__nom" onMouseEnter={() => show(code)} onFocus={() => show(code)} onClick={() => (ouvrir ?? show)(code)}>
            {cardName(cards, code)}
            {copies > 1 && ` ×${copies}`}
          </button>
          <span className="materiaux__marque">{texte}</span>
        </li>
      ))}
    </ul>
  );
}

type PanelProps = {
  listed: Listed[];
  // Activates the Fusion Spell the engine offers (its passcode), when it does.
  spell?: { code: number; activate: () => void };
  close: () => void;
};

// The Extra Deck of the viewer during a duel: each monster with its materials in hand or on the field, the ones that can be summoned now first.
export function ExtraPanel({ listed, spell, close }: Readonly<PanelProps>) {
  const { cards, show } = useDuelView();
  const fermer = useRef<HTMLButtonElement>(null);
  const total = listed.reduce((sum, { copies }) => sum + copies, 0);
  // The close button takes the focus, Escape closes.
  useLayoutEffect(() => fermer.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <dialog open className="panneau pile-liste extra-liste" aria-label="Extra Deck">
      <header className="pile-liste__tete">
        <h2 className="titre-bloc">
          Extra Deck <span className="chiffres">{total}</span>
        </h2>
        <button ref={fermer} type="button" className="btn-icone" aria-label="Fermer" onClick={close}>
          <Icon id="ui-fermer" />
        </button>
      </header>
      {spell && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            close();
            spell.activate();
          }}
        >
          Activer {cardName(cards, spell.code)}
        </button>
      )}
      {listed.length === 0 ? (
        <p className="texte-2">Aucune carte.</p>
      ) : (
        <ol className="pile-liste__cartes">
          {listed.map(({ code, copies, materials, reunited }) => {
            const now = reunited && spell !== undefined;
            return (
              <li key={code} className={now ? "extra-liste__ligne est-invocable" : "extra-liste__ligne"}>
                <button type="button" className="pile-liste__carte" onMouseEnter={() => show(code)} onFocus={() => show(code)} onClick={() => show(code)}>
                  <CardView code={code} />
                  <span>
                    {cardName(cards, code)}
                    {copies > 1 && ` ×${copies}`}
                  </span>
                </button>
                {now && <p className="extra-liste__pret">Invocable maintenant</p>}
                {reunited && !now && <p className="extra-liste__reuni">Matériaux réunis</p>}
                {materials.length > 0 && (
                  <Materiaux items={materials.map((material) => ({ code: material.code, copies: material.copies, etat: material.have ? "ok" : "manque", texte: material.have ? "En main ou sur le terrain" : "Absent" }))} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </dialog>
  );
}
