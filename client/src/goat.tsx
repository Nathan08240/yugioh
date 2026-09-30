import goat from "../../server/data/goat-2005-04.json";
import { limitError, overLimit, sameCard, type DeckDraft } from "../../server/src/deckcheck.ts";
import type { Cards } from "./cards.ts";
import { buildDeck } from "./constructeur.ts";

const LIMITS = new Map(Object.entries(goat).map(([code, max]) => [Number(code), max]));
type Deck = Pick<DeckDraft, "main" | "extra">;

// Cards played beyond the Goat list (the ranked mode and the weekly event apply it), and the same as the server's message.
export const beyondGoat = ({ main, extra }: Deck, cards: Cards): number =>
  overLimit([...main, ...extra], (code) => cards.get(code), LIMITS).reduce((sum, { copies, max }) => sum + copies - max, 0);
const details = ({ main, extra }: Deck, cards: Cards, where: string) => limitError([...main, ...extra], (code) => cards.get(code), LIMITS, where);

const plural = (count: number) => `${count} carte${count > 1 ? "s" : ""}`;

// The deck without the copies beyond the Goat list, completed to 40 by the automatic builder with owned cards that follow it.
export function goatCompliant({ main, extra }: Deck, cards: Cards, owned: ReadonlyMap<number, number>): Deck {
  const kept = new Map<number, number>();
  const allowed = (code: number) => {
    const card = cards.get(code);
    const key = card ? sameCard(code, card) : code;
    kept.set(key, (kept.get(key) ?? 0) + 1);
    return (kept.get(key) ?? 0) <= (LIMITS.get(key) ?? Infinity);
  };
  const trimmed = { main: main.filter(allowed), extra: extra.filter(allowed) };
  const built = buildDeck(cards, owned, {}, trimmed, LIMITS);
  return { main: built.main, extra: built.extra };
}

// Deck builder: a discreet line under the validity message, and a way to follow the list when the deck does not.
export function GoatStatus({ deck, cards, fix }: Readonly<{ deck: Deck; cards: Cards; fix?: () => void }>) {
  const count = beyondGoat(deck, cards);
  if (count === 0) return <p className="texte-3">Classé : conforme</p>;
  return (
    <p className="texte-3" title={details(deck, cards, "en classé")}>
      Classé : {plural(count)} au-delà de la liste Goat{" "}
      {fix && (
        <button type="button" className="lien" onClick={fix}>
          Rendre conforme
        </button>
      )}
    </p>
  );
}

// Ranked screen and event card: a reminder, with a way to the deck builder, when the active deck is not compliant.
export function GoatReminder({ deck, cards, where, go }: Readonly<{ deck?: Deck; cards: Cards; where: string; go: () => void }>) {
  const count = deck && cards.size > 0 ? beyondGoat(deck, cards) : 0;
  if (count === 0) return null;
  return (
    <p className="message message--erreur" role="status" title={details(deck as Deck, cards, where)}>
      Votre deck actif a {plural(count)} au-delà de la liste Goat, qui s'applique {where}.{" "}
      <button type="button" className="lien" onClick={go}>
        Modifier le deck
      </button>
    </p>
  );
}
