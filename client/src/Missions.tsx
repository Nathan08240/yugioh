import type { CSSProperties } from "react";
import { MISSIONS_BONUS, type AchievementView, type MissionReward, type MissionView } from "../../server/src/protocol.ts";
import "./styles/missions.css";
import { Icon } from "./ui.tsx";

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

export function rewardText({ points, boosters }: MissionReward): string {
  return [points && plural(points, "point"), boosters && plural(boosters, "booster")].filter(Boolean).join(" et ");
}

const done = (item: MissionView) => item.progress >= item.goal;

// A goal with its progress bar; once reached, its reward was paid.
function Objectif({ item, title }: Readonly<{ item: MissionView; title?: string }>) {
  return (
    <li className={done(item) ? "objectif objectif--fait" : "objectif"}>
      <span className="objectif__texte">
        {title && <b>{title}</b>}
        {item.text}
      </span>
      <span className="objectif__gain">{rewardText(item.reward)}</span>
      <span className="jauge" style={{ "--v": `${Math.min(item.progress / item.goal, 1) * 100}%` } as CSSProperties} />
      <span className="objectif__suivi chiffres">{done(item) ? <Icon id="ui-coche" label="Fait" /> : `${item.progress} / ${item.goal}`}</span>
    </li>
  );
}

// The 3 missions of the day on the home screen, and the booster of the 3 done.
export function MissionsDuJour({ missions }: Readonly<{ missions?: MissionView[] }>) {
  if (!missions?.length) return null;
  const bonus = missions.every(done) ? "Les 3 missions sont faites : booster bonus gagné." : `Les 3 faites : ${plural(MISSIONS_BONUS, "booster")} en plus.`;
  return (
    <section className="missions panneau" aria-labelledby="missions-titre" data-entree>
      <h2 id="missions-titre" className="titre-bloc">
        Missions du jour <span className="chiffres">{missions.filter(done).length} / {missions.length}</span>
      </h2>
      <ul className="objectifs">
        {missions.map((mission) => (
          <Objectif key={mission.id} item={mission} />
        ))}
      </ul>
      <p className="missions__bonus">
        <Icon id="ui-booster" />
        {bonus}
      </p>
    </section>
  );
}

// Achievements on the profile screen, each rewarded once.
export function Succes({ achievements }: Readonly<{ achievements?: AchievementView[] }>) {
  if (!achievements) return <p className="texte-2">Chargement des succès…</p>;
  return (
    <>
      <h2 className="titre-bloc">Succès {`${achievements.filter(done).length} / ${achievements.length}`}</h2>
      <ul className="objectifs">
        {achievements.map((achievement) => (
          <Objectif key={achievement.id} item={achievement} title={achievement.title} />
        ))}
      </ul>
    </>
  );
}
