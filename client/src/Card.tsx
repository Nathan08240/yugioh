import { OcgLocation, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import type { CardInfo } from "../../server/src/protocol.ts";
import { attributeName, cardName, frame, has, stat, typeLine, useDuelView } from "./cards.ts";

// Card picture, or a card drawn in CSS when its image is not downloaded. Code 0 shows the back.
// `location` is the zone the card sits in on the field: hand and piles show every card upright.
export function CardView({ code, position = 0, location = 0 }: Readonly<{ code: number; position?: number; location?: number }>) {
  const { cards } = useDuelView();
  const info = cards.get(code);
  const classes = ["card"];
  if (location === OcgLocation.MZONE && has(position, OcgPosition.DEFENSE)) classes.push("defense");
  if (has(location, OcgLocation.ONFIELD) && has(position, OcgPosition.FACEDOWN)) classes.push("set");
  if (!code) return <div className={[...classes, "back"].join(" ")} aria-label="carte face cachée" />;
  return (
    <div className={classes.join(" ")}>
      {info?.image ? <img src={`/api/images/${code}.jpg`} alt={info.name} draggable={false} /> : <Drawn code={code} info={info} />}
    </div>
  );
}

function Drawn({ code, info }: Readonly<{ code: number; info?: CardInfo }>) {
  const type = info?.type ?? 0;
  const monster = has(type, OcgType.MONSTER);
  const caption = monster ? attributeName(info?.attribute ?? 0) : info && typeLine(info);
  return (
    <div className={`drawn ${frame(type)}`}>
      <span className="drawn-name">{info?.name ?? `Carte ${code}`}</span>
      {monster && <span className="drawn-level">{"★".repeat(info?.level ?? 0)}</span>}
      <span className="drawn-art">{caption}</span>
      {monster && (
        <span className="drawn-stats">
          {stat(info?.atk ?? 0)} / {stat(info?.def ?? 0)}
        </span>
      )}
    </div>
  );
}

export function CardDetail({ code }: Readonly<{ code?: number }>) {
  const { cards } = useDuelView();
  if (code === undefined) return <p className="muted detail-empty">Survolez une carte pour la voir en détail.</p>;
  const info = cards.get(code);
  return (
    <div className="detail">
      <CardView code={code} />
      <div className="detail-text">
        <h3>{cardName(cards, code)}</h3>
        {info && <CardFacts info={info} />}
      </div>
    </div>
  );
}

function CardFacts({ info }: Readonly<{ info: CardInfo }>) {
  const monster = has(info.type, OcgType.MONSTER);
  return (
    <>
      <p className="muted">[{typeLine(info)}]</p>
      {monster && (
        <p>
          {attributeName(info.attribute)} · Niveau {info.level} · ATK {stat(info.atk)} / DEF {stat(info.def)}
        </p>
      )}
      <p className="card-desc">{info.desc}</p>
    </>
  );
}
