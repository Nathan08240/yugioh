import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import type { ClientMessage, StoryArcView, StoryDuelView, StoryLevel, StoryStatus } from "../../server/src/protocol.ts";
import { cardName, isDivine, useDuelView, type Cards } from "./cards.ts";
import { createQueue, entrance } from "./motion.ts";
import { RuleBlock, specialRules } from "./regles.tsx";
import "./styles/histoire.css";
import { Icon, Rewards } from "./ui.tsx";

const STATUS: Record<StoryStatus, string> = { locked: "Verrouillé", available: "Disponible", done: "Gagné" };

// Switching between the duels of an arc and a briefing replays the entrance of the view.
const views = createQueue();

const wins = (duels: StoryDuelView[]) => duels.filter((duel) => duel.status === "done").length;
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

// The arc being played: the first one with a duel left to win, else the last one.
export const currentArc = (arcs: StoryArcView[]) => arcs.find((arc) => arc.duels.some((duel) => duel.status !== "done")) ?? arcs.at(-1);

export type ArcState = "fini" | "encours" | "verrou";
export function arcState(arc: StoryArcView): ArcState {
  if (arc.duels.every((duel) => duel.status === "done")) return "fini";
  return arc.duels.every((duel) => duel.status === "locked") ? "verrou" : "encours";
}

// "Battle City · Duel 4 sur 5", for the briefing and the end of the duel.
export function duelLabel(arcs: StoryArcView[] | undefined, id: string | undefined): string | undefined {
  for (const arc of arcs ?? []) {
    const index = arc.duels.findIndex((duel) => duel.id === id);
    if (index >= 0) return `${arc.title} · Duel ${index + 1} sur ${arc.duels.length}`;
  }
  return undefined;
}

// The special rules of a story duel, for the duel screen and its end.
export const duelSpecial = (arcs: StoryArcView[] | undefined, id: string | undefined): string[] =>
  arcs?.flatMap((arc) => arc.duels).find((duel) => duel.id === id)?.special ?? [];

function unlockHint(duel: StoryDuelView, arc: StoryArcView, arcs: StoryArcView[]): string {
  const [need] = duel.requires;
  const index = arc.duels.findIndex((candidate) => candidate.id === need);
  if (index >= 0) return `Gagnez le duel ${index + 1} pour le débloquer.`;
  const previous = arcs.find((candidate) => candidate.id === need);
  return previous ? `Terminez l'arc ${previous.title} pour le débloquer.` : "Gagnez les duels précédents pour le débloquer.";
}

// The arc is shown with the artwork of the last card it gives.
function arcArt(arc: StoryArcView, cards: Cards): number | undefined {
  return arc.duels
    .flatMap((duel) => duel.rewards.cards ?? [])
    .filter((code) => cards.get(code)?.image)
    .at(-1);
}

type Props = { arcs?: StoryArcView[]; send: (msg: ClientMessage) => void };

export function Story({ arcs, send }: Readonly<Props>) {
  const [picked, setPicked] = useState<string>();
  const [chosen, setChosen] = useState<string>();
  const view = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  // Progression may have changed since the last visit (a duel just won).
  useEffect(() => send({ type: "story" }), []);

  const arc = arcs && (arcs.find((candidate) => candidate.id === chosen) ?? currentArc(arcs));
  // The Shell plays the entrance of the screen; then each new view rises in cascade.
  useLayoutEffect(() => {
    const root = view.current;
    if (entered.current && root) views.play(entrance(picked ? root : (root.querySelector<HTMLElement>(".parcours") ?? root)));
    entered.current = true;
    if (picked) root?.querySelector("button")?.focus({ preventScroll: true });
  }, [picked, arc?.id]);

  if (!arcs || !arc) return <p className="ecran-message">Chargement de l'histoire…</p>;
  const duel = arc.duels.find((candidate) => candidate.id === picked);
  if (duel) {
    return <Briefing ref={view} duel={duel} label={duelLabel(arcs, duel.id)} back={() => setPicked(undefined)} start={(level) => send({ type: "story_duel", duel: duel.id, level })} />;
  }
  const all = arcs.flatMap((candidate) => candidate.duels);
  const won = wins(all);
  return (
    <div ref={view} className="histoire">
      <div className="histoire__tete" data-entree>
        <div>
          <p className="surtitre">Mode Histoire</p>
          <h1 className="titre">{arc.title}</h1>
        </div>
        <p className="texte-2">
          <b className="chiffres">{won}</b> {won > 1 ? "duels gagnés" : "duel gagné"} sur {all.length}
        </p>
      </div>
      <Arcs arcs={arcs} selected={arc.id} choose={setChosen} />
      <Path arc={arc} arcs={arcs} pick={setPicked} />
    </div>
  );
}

function Arcs({ arcs, selected, choose }: Readonly<{ arcs: StoryArcView[]; selected: string; choose: (id: string) => void }>) {
  const { cards } = useDuelView();
  return (
    <ol className="arcs" aria-label="Arcs" data-entree>
      {arcs.map((arc, index) => {
        const state = arcState(arc);
        const art = arcArt(arc, cards);
        return (
          <li key={arc.id} className={`arc arc--${state}`}>
            <button type="button" aria-current={arc.id === selected ? "true" : undefined} disabled={state === "verrou"} onClick={() => choose(arc.id)}>
              {art && <img src={`/api/art/${art}.jpg`} alt="" />}
              <span className="arc__num">Arc {index + 1}</span>
              <b>{arc.title}</b>
              <ArcProgress arc={arc} state={state} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ArcProgress({ arc, state }: Readonly<{ arc: StoryArcView; state: ArcState }>) {
  if (state === "verrou") {
    return (
      <span className="arc__etat">
        <Icon id="ui-cadenas" />
        Verrouillé
      </span>
    );
  }
  return (
    <span className="arc__etat">
      {state === "fini" && <Icon id="ui-coche" />}
      <span className="sr">Duels gagnés : </span>
      {wins(arc.duels)} / {arc.duels.length}
    </span>
  );
}

type PathProps = { arc: StoryArcView; arcs: StoryArcView[]; pick: (id: string) => void };

// The duels of the arc, joined by a line: gold up to the last duel won, cyan up to the one available.
function Path({ arc, arcs, pick }: Readonly<PathProps>) {
  const count = arc.duels.length;
  const won = wins(arc.duels);
  const available = arc.duels.findIndex((duel) => duel.status === "available");
  const at = (index: number) => `${(Math.max(index, 0) / Math.max(count - 1, 1)) * 100}%`;
  const line = { "--n": count, "--fait": at(won - 1), "--dispo": at(available >= 0 ? available : won - 1) } as CSSProperties;
  return (
    <ol className="parcours" style={line} aria-label={`Duels de ${arc.title}`}>
      {arc.duels.map((duel, index) => (
        <li key={duel.id} className={`etape etape--${duel.status}`} data-entree>
          <span className="etape__num chiffres">{index + 1}</span>
          <p className="etape__etat">
            {duel.status === "done" && <Icon id="ui-coche" />}
            {duel.status === "locked" && <Icon id="ui-cadenas" />}
            {STATUS[duel.status]}
          </p>
          <h2>{duel.title}</h2>
          <p className="texte-2">contre {duel.opponent}</p>
          <Gain duel={duel} />
          <DuelAction duel={duel} hint={unlockHint(duel, arc, arcs)} pick={pick} />
        </li>
      ))}
    </ol>
  );
}

function DuelAction({ duel, hint, pick }: Readonly<{ duel: StoryDuelView; hint: string; pick: (id: string) => void }>) {
  if (duel.status === "locked") return <p className="texte-3">{hint}</p>;
  if (duel.status === "available") {
    return (
      <button type="button" className="btn" onClick={() => pick(duel.id)}>
        Voir le duel
      </button>
    );
  }
  return (
    <button type="button" className="lien" onClick={() => pick(duel.id)}>
      Rejouer<span className="sr"> {duel.title}</span>
    </button>
  );
}

// What the duel gives, in a line: its cards stay a mystery until the duel is unlocked.
function Gain({ duel }: Readonly<{ duel: StoryDuelView }>) {
  const { cards } = useDuelView();
  const codes = duel.rewards.cards ?? [];
  const boosters = duel.rewards.boosters ?? 0;
  const packs = boosters > 0 ? plural(boosters, "booster") : "";
  if (codes.length === 0) {
    return (
      <p className="etape__gain">
        <Icon id="ui-booster" />
        {packs}
      </p>
    );
  }
  const divine = codes.some((code) => isDivine(cards, code));
  const className = divine ? "etape__gain etape__gain--divine" : "etape__gain";
  const more = packs && ` + ${packs}`;
  if (duel.status === "locked") {
    let mystery = divine ? "Une carte divine" : "Une carte à gagner";
    if (codes.length > 1) mystery = `${codes.length} cartes à gagner`;
    return (
      <p className={className}>
        <span className="mystere" aria-hidden="true">
          ?
        </span>
        <span className="etape__libelle">
          {mystery}
          {more}
        </span>
      </p>
    );
  }
  return (
    <p className={className}>
      {codes.map((code) => cards.get(code)?.image && <img key={code} src={`/api/art/${code}.jpg`} alt="" />)}
      <span className="etape__libelle">
        {codes.map((code) => cardName(cards, code)).join(" et ")}
        {more}
      </span>
    </p>
  );
}

// Two initials of the opponent, from the capitalized words of the name ("Bandit Keith": BK).
const initials = (name: string) =>
  name
    .split(" ")
    .filter((word) => word && word[0] !== word[0].toLowerCase())
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

type BriefingProps = { ref?: Ref<HTMLDivElement>; duel: StoryDuelView; label?: string; back: () => void; start: (level: StoryLevel) => void };

const LEVELS: readonly (readonly [StoryLevel, string])[] = [
  ["normal", "Normal"],
  ["facile", "Facile"],
];

// Normal keeps the duel as written; Facile doubles the player's starting LP. Rewards and progression are the same.
function Difficulty({ duel, level, choose }: Readonly<{ duel: StoryDuelView; level: StoryLevel; choose: (level: StoryLevel) => void }>) {
  return (
    <fieldset className="difficulte" data-entree>
      <legend className="titre-bloc">Difficulté</legend>
      <div className="difficulte__choix">
        {LEVELS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="difficulte" value={value} checked={level === value} onChange={() => choose(value)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="texte-2">{level === "facile" ? `Vos LP de départ sont doublés (${duel.lp * 2} LP). Récompenses et progression identiques.` : "Le duel tel qu'il a été écrit."}</p>
    </fieldset>
  );
}

// Before the duel: the opponent projected by the Duel Disk, the story so far, the rules, what can be won.
export function Briefing({ ref, duel, label, back, start }: Readonly<BriefingProps>) {
  const { cards } = useDuelView();
  const rules = specialRules(duel.special);
  const star = duel.rewards.cards?.find((code) => cards.get(code)?.image);
  const replay = duel.status === "done";
  const [level, setLevel] = useState<StoryLevel>("normal");
  return (
    <div ref={ref} className="briefing">
      <div className="briefing__adversaire" aria-hidden="true" data-entree>
        <div className="projecteur__faisceau projecteur__faisceau--adverse" />
        {star && (
          <div className="projecteur__holo projecteur__holo--adverse">
            <img src={`/api/art/${star}.jpg`} alt="" />
          </div>
        )}
        <div className="projecteur__socle projecteur__socle--adverse" />
        <span className="avatar avatar--geant">{initials(duel.opponent)}</span>
      </div>
      <div className="briefing__texte">
        <button type="button" className="lien lien--retour" onClick={back} data-entree>
          <Icon id="ui-retour" />
          Retour aux duels
        </button>
        <div data-entree>
          {label && <p className="surtitre">{label}</p>}
          <h1 className="titre">{duel.title}</h1>
          <p className="briefing__contre">
            contre <b>{duel.opponent}</b>
          </p>
        </div>
        <div className="dialogue panneau panneau--holo" data-entree>
          <p>{duel.intro}</p>
          {duel.outro && <p className="dialogue__suite texte-2">{duel.outro}</p>}
        </div>
        <ul className="puces" data-entree>
          <li className="puce">{duel.lp} LP</li>
          <li className="puce">{duel.hand} cartes en main</li>
        </ul>
        {rules.map((rule) => (
          <RuleBlock key={rule.title} rule={rule} open />
        ))}
        <Difficulty duel={duel} level={level} choose={setLevel} />
        <div className="briefing__bas" data-entree>
          <div className="briefing__gains">
            <h2 className="titre-bloc">{replay ? "Récompenses déjà obtenues" : "Récompenses"}</h2>
            <div className="recompenses">
              <Rewards rewards={duel.rewards} />
            </div>
          </div>
          <button type="button" className="btn btn--grand" onClick={() => start(level)}>
            <Icon id="ui-duel" />
            {replay ? "Rejouer le duel" : "Lancer le duel"}
          </button>
        </div>
      </div>
    </div>
  );
}
