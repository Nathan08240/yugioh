import { useLayoutEffect, useRef } from "react";
import { NO_MONSTER, type Board } from "./board.ts";
import { CardView } from "./Card.tsx";
import { cardName, useDuelView } from "./cards.ts";
import type { LobbyState, StoryWon, TowerWon } from "./lobby.ts";
import { D1, D2, D3, D4, RESSORT, sequences, type AnimOptions, type Sequence, type Step } from "./motion.ts";
import type { Page } from "./Shell.tsx";
import { Signaler, type Report } from "./Signaler.tsx";
import { jouer as jouerSon } from "./son.ts";
import "./styles/fin.css";
import { REPLAY_WINS, TOWER_FLOORS } from "../../server/src/protocol.ts";
import { nextStar, Rewards, Stars } from "./ui.tsx";

type Props = {
  board: Board;
  seat: number;
  room: string;
  // Only an online duel between two players earns a booster.
  vsBot: boolean;
  opponent?: string;
  // A story duel ("Battle City · Duel 4 sur 5"), its special rules, its starting LP as written, and its conclusion once the
  // server has recorded the win.
  story?: { title?: string; won?: StoryWon; special?: readonly string[]; easy?: boolean; lp?: number };
  // A tower duel: its floor, and its win once the server has recorded it. The rematch starts the next floor.
  tower?: { floor: number; won?: TowerWon };
  // Online rematch state; against the bot, asking starts a new duel at once.
  rematch?: LobbyState["rematch"];
  onRematch: (accept: boolean) => void;
  // Bug report button, hidden without it.
  report?: Report;
  leave: () => void;
  go: (page: Page) => void;
};

const RISE: Keyframe[] = [
  { opacity: 0, transform: "translateY(16px)" },
  { opacity: 1, transform: "none" },
];
// Animates the element of `root` matching `selector`, when the screen has one.
const within =
  (root: Element, anim: Step["anim"]) =>
  (selector: string, keyframes: Keyframe[], options?: AnimOptions): Promise<void> | undefined => {
    const el = root.querySelector(selector);
    return el ? anim(el, keyframes, options) : undefined;
  };

// Gold rays, the title tightening, then the score and the rewards in cascade (design/motion.md).
const victory =
  (root: Element): Sequence =>
  async ({ anim }) => {
    const at = within(root, anim);
    await Promise.all([
      at(".rayons", [{ opacity: 0 }, { opacity: 1 }], { duration: D4 + D3 }),
      at(".surtitre", RISE),
      at(".fin__titre", [{ opacity: 0, transform: "scale(1.35)", letterSpacing: "0.35em" }, { opacity: 1, transform: "none", letterSpacing: "0.02em" }], { duration: D4, delay: D1 }),
      at(".fin__score", RISE, { delay: D4 }),
      at(".fin__recit", RISE, { delay: D4 + D1 }),
      at(".fin__etoiles", RISE, { delay: D4 + D2 }),
      ...[...root.querySelectorAll(".fin__gains > *")].map((gain, i) =>
        anim(gain, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { easing: RESSORT, delay: D4 + D2 + i * 150 }),
      ),
      at(".fin__actions", RISE, { duration: D2, delay: D4 * 2 }),
    ]);
  };

// Slower, without rays: the title falls into focus, the signal drops out, the final blow slides in.
const defeat =
  (root: Element): Sequence =>
  async ({ anim }) => {
    const at = within(root, anim);
    const glow = "drop-shadow(0 0 30px rgb(255 106 136 / 0.35))";
    await Promise.all([
      at(".surtitre", RISE),
      at(".fin__titre", [{ opacity: 0, transform: "translateY(-28px)", filter: "blur(8px) drop-shadow(0 0 0 transparent)" }, { opacity: 1, transform: "none", filter: `blur(0) ${glow}` }], { duration: D4 + D3, delay: D2 }),
      at(".fin__titre", [{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0 0" }], { duration: D2, easing: "steps(3)", delay: D2 + D4 + D3 }),
      at(".fin__score", RISE, { delay: D4 + D2 }),
      at(".fin__coup", [{ opacity: 0, transform: "translateX(-24px)" }, { opacity: 1, transform: "none" }], { delay: D4 + D3 }),
      at(".fin__note", RISE, { delay: D4 + D3 }),
      at(".fin__actions", RISE, { delay: D4 * 2 }),
    ]);
  };

// Victory or defeat screen over the board, once the engine has named the winner.
export function Fin({ board, seat, room, vsBot, opponent, story, tower, rematch, onRematch, report, leave, go }: Readonly<Props>) {
  const root = useRef<HTMLDivElement>(null);
  const won = board.winner === seat;
  const lost = board.winner === 1 - seat;

  useLayoutEffect(() => {
    if (!root.current) return;
    root.current.querySelector("button")?.focus({ preventScroll: true });
    sequences.play((won ? victory : defeat)(root.current));
    if (won || lost) jouerSon(won ? "victoire" : "defaite");
  }, [won]);

  let context = `Duel en ligne · salle ${room}`;
  if (story) context = `${story.title ?? "Mode Histoire"}${story.easy ? " · Facile" : ""}`;
  else if (tower) context = `La Tour · Étage ${tower.floor} sur ${TOWER_FLOORS}`;
  else if (vsBot) context = "Duel contre le bot";
  const back = backLabel(Boolean(story), Boolean(tower));
  const boosters = (won && !vsBot && !story ? 1 : storyBoosters(story?.won)) + (tower?.won?.boosters ?? 0);

  return (
    <section className={won ? "ecran ecran--scene fin-duel" : "ecran ecran--scene fin-duel ecran--defaite"} aria-labelledby="fin-titre">
      {won && <div className="rayons" aria-hidden="true" />}
      <div ref={root} className="fin">
        <p className={won ? "surtitre surtitre--or" : "surtitre"}>{context}</p>
        <h1 id="fin-titre" className="fin__titre">
          {title(won, lost)}
        </h1>
        <Score board={board} seat={seat} won={won} lost={lost} opponent={opponent} />
        {won && (tower ? <TowerGains won={tower.won} /> : <Gains story={story} boosters={boosters} />)}
        {(won || lost) && <Cause board={board} seat={seat} won={won} kingdom={story?.special?.includes("duelist-kingdom") ?? false} opponent={opponent} />}
        {lost && tower && <p className="texte-2 fin__note">Une défaite renvoie à l'étage 1 ; votre record est gardé.</p>}
        {lost && !story && !vsBot && <p className="texte-2 fin__note">Le vainqueur d'un duel en ligne reçoit un booster. Retentez votre chance avec un deck ajusté.</p>}
        <div className="fin__actions">
          {boosters > 0 ? (
            <button type="button" className="btn btn--grand" onClick={() => go("boosters")}>
              Ouvrir mes boosters
            </button>
          ) : (
            <button type="button" className={won ? "btn btn--grand" : "btn btn--grand btn--holo"} onClick={leave}>
              {back}
            </button>
          )}
          {boosters > 0 && (
            <button type="button" className="btn btn--fantome" onClick={leave}>
              {back}
            </button>
          )}
          <Rematch online={!vsBot} seat={seat} rematch={rematch} opponent={opponent} onRematch={onRematch} label={tower && towerNext(tower.floor, won)} />
          {lost && (
            <button type="button" className="btn btn--fantome" onClick={() => go("collection")}>
              Modifier mon deck
            </button>
          )}
          {report && <Signaler report={report} />}
        </div>
      </div>
    </section>
  );
}

type RematchProps = Readonly<{ online: boolean; seat: number; rematch?: LobbyState["rematch"]; opponent?: string; onRematch: (accept: boolean) => void; label?: string }>;

function Rematch({ online, seat, rematch, opponent, onRematch, label = "Revanche" }: RematchProps) {
  if (rematch === "declined") {
    return (
      <button type="button" className="btn btn--fantome" disabled>
        Revanche refusée
      </button>
    );
  }
  if (online && rematch?.from === seat) {
    return (
      <button type="button" className="btn btn--fantome" disabled>
        Revanche demandée…
      </button>
    );
  }
  if (online && rematch) {
    return (
      <>
        <p className="texte-2">{opponent ?? "L'adversaire"} propose une revanche</p>
        <button type="button" className="btn" onClick={() => onRematch(true)}>
          Accepter
        </button>
        <button type="button" className="btn btn--fantome" onClick={() => onRematch(false)}>
          Refuser
        </button>
      </>
    );
  }
  return (
    <button type="button" className="btn btn--fantome" onClick={() => onRematch(true)}>
      {label}
    </button>
  );
}

function backLabel(story: boolean, tower: boolean): string {
  if (story) return "Retour à l'histoire";
  return tower ? "Retour à la Tour" : "Retour à l'accueil";
}

// What the rematch of a tower duel starts.
function towerNext(floor: number, won: boolean): string {
  if (!won) return "Recommencer à l'étage 1";
  return floor < TOWER_FLOORS ? "Étage suivant" : "Recommencer la Tour";
}

function TowerGains({ won }: Readonly<{ won?: TowerWon }>) {
  if (!won) return <p className="texte-2 fin__recit">Enregistrement de la victoire…</p>;
  const cleared = won.floor < TOWER_FLOORS ? `Étage ${won.floor} franchi.` : "Sommet de la Tour atteint !";
  return (
    <>
      <p className="fin__recit">
        {cleared} Record : {won.best} étage{won.best > 1 ? "s" : ""}.
      </p>
      {won.boosters > 0 && (
        <div className="fin__gains">
          <Rewards rewards={{ boosters: won.boosters }} />
        </div>
      )}
    </>
  );
}

function title(won: boolean, lost: boolean): string {
  if (won) return "Victoire";
  return lost ? "Défaite" : "Match nul";
}

function Score({ board, seat, won, lost, opponent }: Readonly<{ board: Board; seat: number; won: boolean; lost: boolean; opponent?: string }>) {
  const lp = (player: number) => <span className="chiffres">{Math.max(board.players[player].lp, 0)}</span>;
  const turn = <span className="chiffres">{board.turn}</span>;
  if (won) {
    return (
      <p className="fin__score">
        {lp(seat)} LP restants · tour {turn}
      </p>
    );
  }
  if (lost) {
    return (
      <p className="fin__score">
        {opponent ?? "L'adversaire"} l'emporte au tour {turn} avec {lp(1 - seat)} LP
      </p>
    );
  }
  return <p className="fin__score">Égalité au tour {turn}</p>;
}

// Boosters of a story win: its first-win rewards, the first 3 stars, the last win of a series of replays.
function storyBoosters(won: StoryWon | undefined): number {
  if (!won) return 0;
  return (won.rewards?.boosters ?? 0) + Number(won.starBooster) + Number(won.replays === REPLAY_WINS);
}

// The stars of this win, what the next one asks, the replay series.
function StoryStars({ won, lp }: Readonly<{ won: StoryWon; lp?: number }>) {
  const hint = lp === undefined ? undefined : nextStar(won.best, lp);
  let replay: string | undefined;
  if (won.replays === REPLAY_WINS) replay = `Victoire de rejeu ${REPLAY_WINS}/${REPLAY_WINS} : 1 booster gagné.`;
  else if (won.replays !== undefined) replay = `Victoires de rejeu : ${won.replays}/${REPLAY_WINS} avant le prochain booster.`;
  return (
    <div className="fin__etoiles">
      <Stars count={won.stars} />
      {won.best > won.stars && <p className="texte-2">Meilleure note : {won.best} étoiles.</p>}
      {won.starBooster && <p className="texte-2">3 étoiles : 1 booster gagné.</p>}
      {hint && <p className="texte-2">{hint}</p>}
      {replay && <p className="texte-2">{replay}</p>}
    </div>
  );
}

function Gains({ story, boosters }: Readonly<{ story?: { won?: StoryWon; lp?: number }; boosters: number }>) {
  if (!story) {
    if (!boosters) return null;
    return (
      <div className="fin__gains">
        <Rewards rewards={{ boosters }} />
      </div>
    );
  }
  if (!story.won) return <p className="texte-2 fin__recit">Enregistrement de la victoire…</p>;
  return (
    <>
      <p className="fin__recit">{story.won.outro}</p>
      <StoryStars won={story.won} lp={story.lp} />
      {story.won.rewards ? (
        <div className="fin__gains">
          <Rewards rewards={story.won.rewards} featured />
        </div>
      ) : (
        <p className="texte-2">Récompenses déjà obtenues.</p>
      )}
    </>
  );
}

// WIN reasons of the engine other than "LP at 0" (1), as [the opponent caused it, the player did].
const CAUSES = new Map<number, [string, string]>([
  [0, ["L'adversaire a abandonné.", "Vous avez abandonné."]],
  [2, ["L'adversaire n'a plus de carte à piocher.", "Vous n'avez plus de carte à piocher."]],
  [3, ["Temps limite atteint.", "Temps limite atteint."]],
  [4, ["La connexion de l'adversaire a été perdue.", "Votre connexion a été perdue."]],
  [NO_MONSTER, ["L'adversaire a fini son tour sans monstre et sans en avoir invoqué (règle du Royaume des Duellistes).", "Vous avez fini votre tour sans monstre et sans en avoir invoqué (règle du Royaume des Duellistes)."]],
  [0x56, ["L'adversaire n'a plus de Deck Master (règle du Monde virtuel).", "Vous n'avez plus de Deck Master (règle du Monde virtuel)."]],
]);
const OTHER_CAUSE = "Le duel s'est terminé par l'effet d'une carte ou d'une règle spéciale.";

// How the duel ended: the reason when it is not the loss of all LP, else the last damage taken.
function Cause({ board, seat, won, kingdom, opponent }: Readonly<{ board: Board; seat: number; won: boolean; kingdom: boolean; opponent?: string }>) {
  const reason = board.winReason;
  if (reason === undefined || reason === 1) return won ? null : <FinalBlow board={board} seat={seat} kingdom={kingdom} />;
  const text = CAUSES.get(reason)?.[won ? 0 : 1] ?? OTHER_CAUSE;
  return <p className="texte-2 fin__note">{opponent ? text.replace(/l'adversaire/i, opponent) : text}</p>;
}

// The card behind the last damage the player took, and the Duelist Kingdom rule when the damage comes from it.
function FinalBlow({ board, seat, kingdom }: Readonly<{ board: Board; seat: number; kingdom: boolean }>) {
  const { cards } = useDuelView();
  const hit = board.lastHit;
  if (hit?.player !== seat) return null;
  const destroyed = kingdom ? hit.destroyed : undefined;
  const code = hit.code || destroyed?.[0];
  if (!code) return null;
  const names = destroyed?.map((card) => cardName(cards, card)).join(", ");
  const source = hit.code ? `a détruit ${names}` : "détruit par un effet";
  return (
    <div className="fin__coup">
      <CardView code={code} />
      <p>
        <span className="surtitre">{destroyed ? "Règle du Royaume" : "Coup final"}</span>
        <b>{cardName(cards, code)}</b>
        <span className="texte-2">{destroyed ? `${source}, vous perdez la moitié de son ATK : ${hit.amount} points de dégâts` : `${hit.amount} points de dégâts`}</span>
      </p>
    </div>
  );
}
