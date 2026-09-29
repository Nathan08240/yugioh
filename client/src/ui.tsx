import type { Rewards as Earned } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, ICONS, isDivine, rarityKey, rarityLabel, useDuelView } from "./cards.ts";

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
