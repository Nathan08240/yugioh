import goat from "../../server/data/goat-2005-04.json";
import { limitError, overLimit, type DeckDraft } from "../../server/src/deckcheck.ts";
import type { Cards } from "./cards.ts";

const LIMITS = new Map(Object.entries(goat).map(([code, max]) => [Number(code), max]));
type Deck = Pick<DeckDraft, "main" | "extra">;

// Cards played beyond the Goat list (the ranked mode and the weekly event apply it), and the same as the server's message.
export const beyondGoat = ({ main, extra }: Deck, cards: Cards): number =>
  overLimit([...main, ...extra], (code) => cards.get(code), LIMITS).reduce((sum, { copies, max }) => sum + copies - max, 0);
const details = ({ main, extra }: Deck, cards: Cards, where: string) => limitError([...main, ...extra], (code) => cards.get(code), LIMITS, where);

const plural = (count: number) => `${count} carte${count > 1 ? "s" : ""}`;

// Deck builder: a discreet line under the validity message.
export function GoatStatus({ deck, cards }: Readonly<{ deck: Deck; cards: Cards }>) {
  const count = beyondGoat(deck, cards);
  if (count === 0) return <p className="texte-3">Classé : conforme</p>;
  return (
    <p className="texte-3" title={details(deck, cards, "en classé")}>
      Classé : {plural(count)} au-delà de la liste Goat
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
