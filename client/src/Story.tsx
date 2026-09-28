import { useEffect, useState } from "react";
import type { ClientMessage, Rewards, StoryArcView, StoryDuelView, StoryStatus } from "../../server/src/protocol.ts";
import { cardName, useCards, type Cards } from "./cards.ts";

const STATUS: Record<StoryStatus, string> = { locked: "Verrouillé", available: "Disponible", done: "Gagné" };

// Special rules of the story data (server/src/story.ts EXTRA_RULES), as the player reads them.
const RULES = new Map([
  [
    "duelist-kingdom",
    {
      title: "Règles du Royaume des Duellistes",
      details: [
        "Pas d'attaque directe.",
        "Invocation Normale possible en Position de Défense face recto.",
        "Monstres de niveau 5 ou plus invoqués sans Sacrifice.",
        "Un monstre détruit par un effet inflige à son contrôleur la moitié de son ATK.",
        "Un seul monstre peut attaquer par tour.",
        "Qui finit son tour sans monstre et sans en avoir invoqué perd le duel.",
      ],
    },
  ],
]);

const boosters = (count: number) => (count > 1 ? `${count} boosters à ouvrir` : "1 booster à ouvrir");

export function RewardList({ rewards, cards }: Readonly<{ rewards: Rewards; cards: Cards }>) {
  const items = [...(rewards.boosters ? [boosters(rewards.boosters)] : []), ...(rewards.cards ?? []).map((code) => `Carte : ${cardName(cards, code)}`)];
  if (items.length === 0) return <p className="muted">Aucune récompense.</p>;
  return (
    <ul className="rewards">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

type Props = { arcs?: StoryArcView[]; send: (msg: ClientMessage) => void; close: () => void };

export function Story({ arcs, send, close }: Readonly<Props>) {
  const [picked, setPicked] = useState<string>();
  // Progression may have changed since the last visit (a duel just won).
  useEffect(() => send({ type: "story" }), []);

  if (!arcs) return <p className="muted">Chargement de l'histoire…</p>;
  const duel = arcs.flatMap((arc) => arc.duels).find((candidate) => candidate.id === picked);
  if (duel) return <Briefing duel={duel} back={() => setPicked(undefined)} start={() => send({ type: "story_duel", duel: duel.id })} />;
  return (
    <div className="stack">
      <div className="story-head">
        <h2>Mode Histoire</h2>
        <button type="button" className="link" onClick={close}>
          Accueil
        </button>
      </div>
      {arcs.map((arc) => (
        <section key={arc.id} className="arc">
          <h3>{arc.title}</h3>
          <ol>
            {arc.duels.map((entry, index) => (
              <li key={entry.id}>
                <button type="button" className={`story-duel ${entry.status}`} disabled={entry.status === "locked"} onClick={() => setPicked(entry.id)}>
                  <span className="story-num">{index + 1}</span>
                  <span className="story-name">
                    {entry.title}
                    <small>contre {entry.opponent}</small>
                  </span>
                  <span className="story-status">{STATUS[entry.status]}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Briefing({ duel, back, start }: Readonly<{ duel: StoryDuelView; back: () => void; start: () => void }>) {
  const cards = useCards();
  const rules = duel.special.flatMap((name) => RULES.get(name) ?? []);
  return (
    <div className="stack">
      <div className="story-head">
        <h2>{duel.title}</h2>
        <button type="button" className="link" onClick={back}>
          Retour aux duels
        </button>
      </div>
      <p className="muted">Adversaire : {duel.opponent}</p>
      <ul className="chips">
        <li className="chip">{duel.lp} LP</li>
        <li className="chip">{duel.hand} cartes en main</li>
      </ul>
      {rules.map((rule) => (
        <details key={rule.title} className="story-rules">
          <summary>{rule.title}</summary>
          <ul>
            {rule.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      ))}
      <p className="story-text">{duel.intro}</p>
      {duel.outro && <p className="story-text muted">{duel.outro}</p>}
      <h3>{duel.status === "done" ? "Récompenses (déjà obtenues)" : "Récompenses"}</h3>
      <RewardList rewards={duel.rewards} cards={cards} />
      <button type="button" onClick={start}>
        {duel.status === "done" ? "Rejouer le duel" : "Lancer le duel"}
      </button>
    </div>
  );
}
