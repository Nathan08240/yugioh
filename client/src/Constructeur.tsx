import { useMemo, useState } from "react";
import suggested from "../../server/data/suggested-decks.json";
import { MAIN_MIN, type DeckDraft } from "../../server/src/deckcheck.ts";
import { cardName, useDuelView } from "./cards.ts";
import { buildDeck, themes, type Built, type Style } from "./constructeur.ts";
import type { Suggestion } from "./deckTools.ts";

const SUGGESTIONS = suggested as Suggestion[];
const MISSING_SHOWN = 6;

type Props = { collection: [number, number][]; draft?: DeckDraft; onCreate: (draft: DeckDraft) => void };

// Builds a deck from the owned cards, or completes the edited one, in a chosen style. The player edits and saves it as usual.
export function Constructeur({ collection, draft, onCreate }: Readonly<Props>) {
  const { cards } = useDuelView();
  const owned = useMemo(() => new Map(collection), [collection]);
  const options = useMemo(() => themes(cards), [cards]);
  // "" for the strongest deck, "t<index>" for a theme, "s<id>" for a suggested deck.
  const [choice, setChoice] = useState("");
  const [built, setBuilt] = useState<Built>();

  const chosen = (): { style: Style; name: string } => {
    const theme = choice.startsWith("t") ? options[Number(choice.slice(1))] : undefined;
    if (theme) return { style: { theme }, name: `Deck ${theme.label}` };
    const base = SUGGESTIONS.find(({ id }) => `s${id}` === choice);
    if (base) return { style: { base }, name: base.title };
    return { style: {}, name: "Deck le plus fort" };
  };
  const run = (keep?: DeckDraft) => {
    const { style, name } = chosen();
    const result = buildDeck(cards, owned, style, keep);
    setBuilt(result);
    onCreate(keep ? { ...keep, main: result.main, extra: result.extra } : { name, main: result.main, extra: result.extra });
  };

  return (
    <details className="suggestions constructeur">
      <summary>Construction automatique</summary>
      <label className="choix">
        <span>Style du deck</span>
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Le plus fort</option>
          <optgroup label="Thème">
            {options.map((theme, index) => (
              <option key={`${theme.kind}-${theme.value}`} value={`t${index}`}>
                {theme.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="À partir d'un deck suggéré">
            {SUGGESTIONS.map(({ id, title }) => (
              <option key={id} value={`s${id}`}>
                {title}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="deck-actions">
        <button type="button" className="btn" onClick={() => run()}>
          Construire un deck avec ma collection
        </button>
        <button type="button" className="btn btn--fantome" disabled={!draft} onClick={() => draft && run(draft)}>
          Compléter ce deck
        </button>
      </div>
      {built && <Report built={built} />}
    </details>
  );
}

function Report({ built }: Readonly<{ built: Built }>) {
  const { cards } = useDuelView();
  const names = (codes: number[]) => codes.map((code) => cardName(cards, code)).join(", ");
  const short = MAIN_MIN - built.main.length;
  return (
    <div className="texte-3" role="status">
      {short > 0 && (
        <p className="message message--erreur">
          Collection trop petite : {built.main.length} cartes sur {MAIN_MIN}, il en manque {short}. Ouvrez des boosters pour compléter le deck.
        </p>
      )}
      <p>Monstres par niveau : {built.levels.map(([level, count]) => `niveau ${level} ×${count}`).join(", ") || "aucun"}.</p>
      {built.keys.length > 0 && <p>Cartes clés incluses : {names(built.keys)}.</p>}
      {built.missing.length > 0 && <p>Cartes clés qui amélioreraient le deck : {names(built.missing.slice(0, MISSING_SHOWN))}.</p>}
    </div>
  );
}
