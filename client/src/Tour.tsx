import { useEffect } from "react";
import type { BotLevel, ClientMessage, TowerView } from "../../server/src/protocol.ts";
import "./styles/tour.css";
import { Icon } from "./ui.tsx";

const LEVELS: Record<BotLevel, string> = { debutant: "Débutant", normal: "Normal", expert: "Expert" };
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

// "Étage 4 · record : 6 étages", for the home screen.
export function towerLine(tower: TowerView): string {
  const record = tower.best > 0 ? ` · record : ${plural(tower.best, "étage")}` : "";
  return `Étage ${tower.floor + 1} sur ${tower.floors.length}${record}`;
}

function floorState(floor: number, tower: TowerView): string {
  if (floor <= tower.floor) return "tour__etage tour__etage--franchi";
  return floor === tower.floor + 1 ? "tour__etage tour__etage--actuel" : "tour__etage";
}

type Props = { tower?: TowerView; send: (msg: ClientMessage) => void };

// The 10 floors from the top, the floor to play, the record and the rewards already taken.
export function Tour({ tower, send }: Readonly<Props>) {
  // Progression may have changed since the last visit (a duel just played).
  useEffect(() => send({ type: "tower" }), []);
  if (!tower) return <p className="ecran-message">Chargement de la Tour…</p>;
  const next = tower.floor + 1;
  const claimed = new Set(tower.claimed);
  return (
    <div className="tour">
      <div className="tour__tete" data-entree>
        <div>
          <p className="surtitre">Mode Tour</p>
          <h1 className="titre">La Tour</h1>
          <p className="texte-2">
            {tower.floors.length} étages contre le bot avec votre deck actif. Une victoire fait monter d'un étage, une défaite renvoie à l'étage 1 ; le
            record est gardé.
          </p>
        </div>
        <p className="compteurs">
          <span>
            <Icon id="ui-duel" />
            Étage <b className="chiffres">{next}</b>
          </span>
          <span>
            <Icon id="ui-trophee" />
            Record : <b className="chiffres">{plural(tower.best, "étage")}</b>
          </span>
        </p>
      </div>
      <ol className="tour__etages" data-entree>
        {tower.floors.toReversed().map((floor, index) => {
          const number = tower.floors.length - index;
          return (
            <li key={number} className={floorState(number, tower)} aria-current={number === next ? "step" : undefined}>
              <b className="tour__numero chiffres">{number}</b>
              <span>
                <b>{floor.opponent}</b>
                <span className="texte-2">
                  {LEVELS[floor.level]} · {floor.lp} LP
                </span>
              </span>
              {floor.boosters > 0 && (
                <span className={claimed.has(number) ? "puce puce--succes" : "puce puce--or"}>
                  {claimed.has(number) && <Icon id="ui-coche" />}
                  {plural(floor.boosters, "booster")}
                  {claimed.has(number) && " obtenus"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn--grand" data-entree onClick={() => send({ type: "tower_duel" })}>
        Monter à l'étage {next}
      </button>
    </div>
  );
}
