import type { Rewards as Earned } from "../../server/src/protocol.ts";
import { thumbSmall } from "./art.ts";
import { CardView } from "./Card.tsx";
import { cardName, ICONS, isDivine, rarityKey, rarityLabel, useDuelView } from "./cards.ts";
import { bestRarity, type Copies } from "./collection.ts";

// An icon of the sprite public/icons.svg (attr-feu, type-magie, ui-bot...). Decorative unless it has a label.
export function Icon({ id, label, className }: Readonly<{ id: string; label?: string; className?: string }>) {
  return (
    <svg className={className ? `ic ${className}` : "ic"} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <use href={`${ICONS}#${id}`} />
    </svg>
  );
}

// Rarity badge of a printing ("super" gives Super Rare in cyan).
export function Rarity({ rarity }: Readonly<{ rarity: string }>) {
  return <span className={`rarete rarete--${rarityKey(rarity)}`}>{rarityLabel(rarity)}</span>;
}

// Badge of the rarest copy owned, over a card of a collection grid; none for a common one.
export function BestRarity({ copies }: Readonly<{ copies?: Copies }>) {
  const best = bestRarity(copies);
  if (!best || rarityKey(best) === "commune") return null;
  return (
    <span className="meilleure-rarete">
      <Rarity rarity={best} />
    </span>
  );
}

const boosters = (count: number) => (count > 1 ? `${count} boosters` : "1 booster");

// Rewards as .recompense items (boosters as packs, cards drawn), for a .recompenses or .fin__gains container.
// `featured` puts the cards forward, as just won. A divine card gets the gold aura (histoire.css).
export function Rewards({ rewards, featured = false }: Readonly<{ rewards: Earned; featured?: boolean }>) {
  const { cards } = useDuelView();
  const count = rewards.boosters ?? 0;
  return (
    <>
      {count > 0 && (
        <div className="recompense">
          <span className="mini-paquet" aria-hidden="true" />
          {count > 1 && <span className="mini-paquet" aria-hidden="true" />}
          <b>{boosters(count)}</b>
        </div>
      )}
      {rewards.cards?.map((code) => {
        const divine = isDivine(cards, code);
        const classes = ["recompense"];
        if (featured) classes.push("recompense--vedette");
        if (divine) classes.push("recompense--divine");
        return (
          <div key={code} className={classes.join(" ")}>
            <CardView code={code} rarity={featured ? "ultra" : undefined} />
            <b>{cardName(cards, code)}</b>
            {featured && <span className="puce puce--or">{divine ? "Carte divine" : "Carte gagnée"}</span>}
          </div>
        );
      })}
    </>
  );
}

// Estimate of a battle before an attack (see apercuCombat).
export function Apercu({ texte }: Readonly<{ texte: string }>) {
  return (
    <p className="apercu">
      {texte} <small>Estimation, hors effets de cartes.</small>
    </p>
  );
}

// Stars of a story duel, out of 3.
export function Stars({ count }: Readonly<{ count: number }>) {
  return (
    <span className="etoiles" role="img" aria-label={`${count} étoile${count > 1 ? "s" : ""} sur 3`}>
      {[1, 2, 3].map((star) => (
        <span key={star} className={star <= count ? "etoile etoile--gagnee" : "etoile"} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

// LP to keep for the 3rd star: half the starting LP.
const starLp = (lp: number) => Math.ceil(lp / 2);

// What each star asks, for a duel starting at `lp` LP.
export const starRules = (lp: number) => ["Gagner le duel", "Gagner en Normal", `Gagner en Normal avec au moins ${starLp(lp)} LP`];

// What is missing for the next star after `best`, none once all 3 are won.
export function nextStar(best: number, lp: number): string | undefined {
  if (best >= 3) return undefined;
  return best === 2 ? `Gagnez en Normal avec au moins ${starLp(lp)} LP pour la 3e étoile.` : "Gagnez en Normal pour la 2e étoile.";
}

// Hexagonal avatar: the artwork of the card chosen as avatar when it is available, else the initial of the name.
export function Avatar({ name, code, className = "" }: Readonly<{ name: string; code?: number; className?: string }>) {
  const { cards } = useDuelView();
  const art = code !== undefined && cards.get(code)?.image;
  return (
    <span className={`avatar ${className}`.trim()} aria-hidden="true">
      {art ? <img className="avatar__art" src={thumbSmall(code)} alt="" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

// Closes the detail of a card shown full screen on a phone; hidden on a wider screen (cartes.css).
export function FermerFiche({ fermer }: Readonly<{ fermer: () => void }>) {
  return (
    <button type="button" className="btn-icone fiche__fermer" aria-label="Fermer la fiche" onClick={fermer}>
      <Icon id="ui-fermer" />
    </button>
  );
}
