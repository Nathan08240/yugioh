import { useLayoutEffect, useRef } from "react";
import type { Board } from "./board.ts";
import { CardView } from "./Card.tsx";
import { cardName, useDuelView } from "./cards.ts";
import type { StoryWon } from "./lobby.ts";
import { D1, D2, D3, D4, RESSORT, sequences, type AnimOptions, type Sequence, type Step } from "./motion.ts";
import type { Page } from "./Shell.tsx";
import "./styles/fin.css";
import { Rewards } from "./ui.tsx";

type Props = {
  board: Board;
  seat: number;
  room: string;
  // Only an online duel between two players earns a booster.
  vsBot: boolean;
  // A story duel ("Battle City · Duel 4 sur 5"), with its conclusion once the server has recorded the win.
  story?: { title?: string; won?: StoryWon };
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
export function Fin({ board, seat, room, vsBot, story, leave, go }: Readonly<Props>) {
  const root = useRef<HTMLDivElement>(null);
  const won = board.winner === seat;
  const lost = board.winner === 1 - seat;

  useLayoutEffect(() => {
    if (!root.current) return;
    root.current.querySelector("button")?.focus({ preventScroll: true });
    sequences.play((won ? victory : defeat)(root.current));
  }, [won]);

  let context = `Duel en ligne · salle ${room}`;
  if (story) context = story.title ?? "Mode Histoire";
  else if (vsBot) context = "Duel contre le bot";
  const back = story ? "Retour à l'histoire" : "Retour à l'accueil";
  const boosters = won && !vsBot && !story ? 1 : (story?.won?.rewards?.boosters ?? 0);

  return (
    <section className={won ? "ecran ecran--scene fin-duel" : "ecran ecran--scene fin-duel ecran--defaite"} aria-labelledby="fin-titre">
      {won && <div className="rayons" aria-hidden="true" />}
      <div ref={root} className="fin">
        <p className={won ? "surtitre surtitre--or" : "surtitre"}>{context}</p>
        <h1 id="fin-titre" className="fin__titre">
          {title(won, lost)}
        </h1>
        <Score board={board} seat={seat} won={won} lost={lost} />
        {won && <Gains story={story} boosters={boosters} />}
        {lost && <FinalBlow board={board} seat={seat} />}
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
          {lost && (
            <button type="button" className="btn btn--fantome" onClick={() => go("collection")}>
              Modifier mon deck
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function title(won: boolean, lost: boolean): string {
  if (won) return "Victoire";
  return lost ? "Défaite" : "Match nul";
}

function Score({ board, seat, won, lost }: Readonly<{ board: Board; seat: number; won: boolean; lost: boolean }>) {
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
        L'adversaire l'emporte au tour {turn} avec {lp(1 - seat)} LP
      </p>
    );
  }
  return <p className="fin__score">Égalité au tour {turn}</p>;
}

function Gains({ story, boosters }: Readonly<{ story?: { won?: StoryWon }; boosters: number }>) {
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

// The card behind the last damage the player took.
function FinalBlow({ board, seat }: Readonly<{ board: Board; seat: number }>) {
  const { cards } = useDuelView();
  const hit = board.lastHit;
  if (hit?.player !== seat || !hit.code) return null;
  return (
    <div className="fin__coup">
      <CardView code={hit.code} />
      <p>
        <span className="surtitre">Coup final</span>
        <b>{cardName(cards, hit.code)}</b>
        <span className="texte-2">{hit.amount} points de dégâts</span>
      </p>
    </div>
  );
}
