import { OcgLocation, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { PointerEvent } from "react";
import type { CardInfo } from "../../server/src/protocol.ts";
import { attributeKey, frame, has, ICONS, rarityKey, stat, useDuelView } from "./cards.ts";
import { prefersReduced } from "./motion.ts";

type Props = {
  code: number;
  // Engine position and location: a monster in defense turns sideways, a face-down card on the field gets the veil.
  position?: number;
  location?: number;
  // Adds the text of the card below it, for the detail panels.
  full?: boolean;
  // Printing rarity of the server ("common", "super"...), for its holographic treatment.
  rarity?: string;
  // Game states of cartes.css: est-cible, est-choisie, est-inactive, est-activee.
  className?: string;
};

const SHINY: ReadonlySet<string> = new Set(["super", "ultra", "ultimate", "secret"]);

// A card drawn in CSS around its artwork (cartes.css), sized by --carte-l. Code 0 shows the back.
// Hand and piles show every card upright: only the field turns defense monsters and veils set cards.
export function CardView({ code, position = 0, location = 0, full = false, rarity, className }: Readonly<Props>) {
  const { cards } = useDuelView();
  const classes = ["carte"];
  if (className) classes.push(className);
  if (location === OcgLocation.MZONE && has(position, OcgPosition.DEFENSE)) classes.push("est-defense");
  if (!code) return <div className={[...classes, "dos"].join(" ")} role="img" aria-label="carte face cachée" />;
  if (has(location, OcgLocation.ONFIELD) && has(position, OcgPosition.FACEDOWN)) classes.push("est-posee");
  const info = cards.get(code);
  const monster = has(info?.type ?? OcgType.MONSTER, OcgType.MONSTER);
  const attribute = attributeKey(info?.attribute ?? 0);
  const icon = gem(info?.type ?? 0, monster, attribute);
  const shine = rarity ? rarityKey(rarity) : "commune";
  classes.push(`t-${frame(info?.type ?? 0)}`);
  if (monster && attribute) classes.push(`a-${attribute}`);
  if (shine !== "commune") classes.push(`r-${shine}`);
  const name = info?.name ?? `Carte ${code}`;
  const shiny = SHINY.has(shine);

  const card = (
    <div className={classes.join(" ")} onPointerMove={shiny ? follow : undefined} onPointerLeave={shiny ? rest : undefined}>
      <div className="carte__art">
        {/* Without artwork, or when it fails to load, the icon of the gem fills the frame. */}
        <svg className="ic carte__repli" aria-hidden="true">
          <use href={`${ICONS}#${icon}`} />
        </svg>
        {info?.image && (
          <img
            src={`/api/art/${code}.jpg`}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
      </div>
      <span className="carte__attr" title={monster ? info?.attributeName : info?.typeLine}>
        <svg className="ic" aria-hidden="true">
          <use href={`${ICONS}#${icon}`} />
        </svg>
      </span>
      {monster && Boolean(info?.level) && (
        <span className="carte__niveau" aria-label={`Niveau ${info?.level}`}>
          {info?.level}
        </span>
      )}
      <div className="carte__infos">
        <p className="carte__nom">{name}</p>
        <p className="carte__type">{info?.typeLine}</p>
        {monster && info && (
          <p className="carte__stats">
            <span>
              ATK<b>{stat(info.atk)}</b>
            </span>
            <span>
              DEF<b>{stat(info.def)}</b>
            </span>
          </p>
        )}
      </div>
    </div>
  );
  if (!full) return card;
  return (
    <article className="detail">
      {card}
      <Text info={info} name={name} monster={monster} />
    </article>
  );
}

// Icon of the gem: the attribute of a monster, the kind of a spell or trap.
function gem(type: number, monster: boolean, attribute: string | undefined): string {
  if (!monster) return has(type, OcgType.TRAP) ? "type-piege" : "type-magie";
  return `attr-${attribute ?? "lumiere"}`;
}

// The glare of the shiny rarities follows the pointer and the card tilts, without the tilt when motion is reduced.
function follow(event: PointerEvent<HTMLDivElement>) {
  const card = event.currentTarget;
  const box = card.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  card.style.setProperty("--reflet-x", `${x * 100}%`);
  card.style.setProperty("--reflet-y", `${y * 100}%`);
  card.style.transform = prefersReduced() ? "" : `perspective(700px) rotateY(${(x - 0.5) * 18}deg) rotateX(${(0.5 - y) * 14}deg)`;
}

function rest(event: PointerEvent<HTMLDivElement>) {
  const { style } = event.currentTarget;
  style.removeProperty("--reflet-x");
  style.removeProperty("--reflet-y");
  style.transform = "";
}

// Normal monsters carry flavor text, in italics as on the printed cards.
function Text({ info, name, monster }: Readonly<{ info?: CardInfo; name: string; monster: boolean }>) {
  if (!info) return null;
  const meta = monster ? `${info.attributeName} · Niveau ${info.level} · ${info.typeLine}` : info.typeLine;
  const flavor = monster && has(info.type, OcgType.NORMAL);
  return (
    <div className="detail__texte">
      <h3>{name}</h3>
      <p className="detail__meta">{meta}</p>
      {monster && (
        <p className="detail__stats">
          ATK <b>{stat(info.atk)}</b> DEF <b>{stat(info.def)}</b>
        </p>
      )}
      <p className={flavor ? "detail__desc saveur" : "detail__desc"}>{info.desc}</p>
    </div>
  );
}

export function CardDetail({ code }: Readonly<{ code?: number }>) {
  if (code === undefined) return <p className="detail-vide">Survolez une carte pour la voir en détail.</p>;
  return <CardView code={code} full />;
}
