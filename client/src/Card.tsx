import { OcgLocation, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { CardInfo } from "../../server/src/protocol.ts";
import { frame, has, stat, useDuelView } from "./cards.ts";

type Props = { code: number; position?: number; location?: number; full?: boolean };

// A card frame drawn in CSS around the artwork; `full` adds the type line and the text. Code 0 shows the back.
// `location` is the zone the card sits in on the field: hand and piles show every card upright.
export function CardView({ code, position = 0, location = 0, full = false }: Readonly<Props>) {
  const { cards } = useDuelView();
  const classes = ["card"];
  if (location === OcgLocation.MZONE && has(position, OcgPosition.DEFENSE)) classes.push("defense");
  if (has(location, OcgLocation.ONFIELD) && has(position, OcgPosition.FACEDOWN)) classes.push("set");
  if (!code) return <div className={[...classes, "back"].join(" ")} aria-label="carte face cachée" />;
  const info = cards.get(code);
  const monster = has(info?.type ?? 0, OcgType.MONSTER);
  classes.push(frame(info?.type ?? 0));
  if (full) classes.push("full");
  return (
    <div className={classes.join(" ")}>
      <div className="face">
        <div className="face-name">
          <span>{info?.name ?? `Carte ${code}`}</span>
          <Attribute info={info} monster={monster} />
        </div>
        {monster ? <Level info={info} /> : <p className="face-kind">[{info?.typeLine}]</p>}
        <Art code={code} info={info} />
        {full && <Text info={info} monster={monster} />}
        {!full && monster && (
          <p className="face-stats">
            {stat(info?.atk ?? 0)} / {stat(info?.def ?? 0)}
          </p>
        )}
      </div>
    </div>
  );
}

function Attribute({ info, monster }: Readonly<{ info?: CardInfo; monster: boolean }>) {
  if (!info) return null;
  if (monster) return <span className={`face-attr attr-${info.attribute}`} title={info.attributeName} />;
  return <span className="face-attr" title={info.typeLine} />;
}

function Level({ info }: Readonly<{ info?: CardInfo }>) {
  const level = info?.level ?? 0;
  return (
    <p className="face-level">
      <span className="face-attr-name">{info?.attributeName}</span>
      <span className="face-stars" aria-label={`Niveau ${level}`}>
        {"★".repeat(level)}
      </span>
    </p>
  );
}

// The type line shows through when the artwork is missing or fails to load.
function Art({ code, info }: Readonly<{ code: number; info?: CardInfo }>) {
  return (
    <div className="face-art">
      <span>{info?.typeLine}</span>
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
  );
}

// Normal monsters carry flavor text, in italics as on the printed cards.
function Text({ info, monster }: Readonly<{ info?: CardInfo; monster: boolean }>) {
  if (!info) return null;
  const flavor = monster && has(info.type, OcgType.NORMAL);
  return (
    <div className="face-text">
      {monster && <p className="face-type">[{info.typeLine}]</p>}
      <p className={flavor ? "face-desc flavor" : "face-desc"}>{info.desc}</p>
      {monster && (
        <p className="face-stats">
          ATK/{stat(info.atk)} DEF/{stat(info.def)}
        </p>
      )}
    </div>
  );
}

export function CardDetail({ code }: Readonly<{ code?: number }>) {
  if (code === undefined) return <p className="muted detail-empty">Survolez une carte pour la voir en détail.</p>;
  return (
    <div className="detail">
      <CardView code={code} full />
    </div>
  );
}
