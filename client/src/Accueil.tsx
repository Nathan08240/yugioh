import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BotLevel, ClientMessage, PuzzleView, StoryArcView } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, stat, strongest, useDuelView } from "./cards.ts";
import { countdown, inviteLink, type DeckList, type LobbyState } from "./lobby.ts";
import { RuleBlock, specialRules } from "./regles.tsx";
import type { Page } from "./Shell.tsx";
import { towerLine } from "./Tour.tsx";
import "./styles/accueil.css";
import { Icon } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const BOT_LEVELS: [BotLevel, string][] = [
  ["debutant", "Débutant"],
  ["normal", "Normal"],
  ["expert", "Expert"],
];

const activeDeck = (decks?: DeckList) => decks?.decks.find((deck) => deck.id === decks.active);

// The arc being played: the first one with a duel left to win, else the last one.
function currentArc(arcs: StoryArcView[]) {
  const arc = arcs.find((candidate) => candidate.duels.some((duel) => duel.status !== "done")) ?? arcs.at(-1);
  if (!arc) return undefined;
  return { title: arc.title, won: arc.duels.filter((duel) => duel.status === "done").length, total: arc.duels.length };
}

export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Home: the game modes, and the strongest card of the active deck projected by the Duel Disk.
export function Accueil({ state, send, go }: Readonly<{ state: LobbyState; send: Send; go: (page: Page) => void }>) {
  const { cards } = useDuelView();
  // Once per visit: the modes show the boosters, the story progression and the collection.
  useEffect(() => {
    send({ type: "booster_state" });
    send({ type: "story" });
    send({ type: "puzzles" });
    send({ type: "tower" });
    send({ type: "collection" });
    send({ type: "decks" });
    send({ type: "event" });
  }, []);

  const [choosingLevel, setChoosingLevel] = useState(false);
  const deck = activeDeck(state.decks);
  const [star] = useMemo(() => strongest(deck?.main ?? [], cards, 1), [deck, cards]);
  const hour = new Date().getHours();
  return (
    <div className="accueil">
      <div className="accueil__menu">
        <p className="surtitre" data-entree>
          {hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour"}, {state.pseudo}
        </p>
        <h1 className="titre" data-entree>
          Prêt pour le duel ?
        </h1>
        {state.daily && (
          <p className="puce puce--succes" role="status" data-entree>
            Récompense du jour : 1 booster gagné, à ouvrir dans Boosters.
          </p>
        )}
        <article className="mode mode--principal" data-entree>
          <div className="mode__tete">
            <Icon id="ui-en-ligne" className="mode__ic" />
            <div>
              <h2>Jouer en ligne</h2>
              <p>Un duel contre un ami, avec votre deck actif. Le gagnant reçoit un booster.</p>
            </div>
          </div>
          <div className="mode__actions">
            <button type="button" className="btn" onClick={() => send({ type: "create" })}>
              Créer une salle
            </button>
            <CodeForm id="code-salle" action="Rejoindre" className="btn btn--holo" send={(room) => send({ type: "join", room })} />
            <CodeForm id="code-regarder" action="Regarder un duel" className="btn btn--fantome" send={(room) => send({ type: "spectate", room })} />
          </div>
        </article>
        {state.event && <EventCard event={state.event} send={send} />}
        <Mode icon="ui-trophee" title="Classé" onClick={() => go("classe")}>
          {state.ranked ? `Classement ${state.ranked.rating} · ` : ""}Un adversaire de votre niveau, classement Elo.
        </Mode>
        {choosingLevel ? (
          <article className="mode" data-entree>
            <Icon id="ui-bot" className="mode__ic" />
            <span>
              <span className="mode__titre">Contre le bot</span>
              <span className="mode__desc">Choisissez son niveau.</span>
            </span>
            <span className="mode__niveaux">
              {BOT_LEVELS.map(([level, label]) => (
                <button key={level} type="button" className="btn" onClick={() => send({ type: "bot", level })}>
                  {label}
                </button>
              ))}
              <button type="button" className="btn btn--fantome" onClick={() => setChoosingLevel(false)}>
                Retour
              </button>
            </span>
          </article>
        ) : (
          <Mode icon="ui-bot" title="Contre le bot" onClick={() => setChoosingLevel(true)}>
            Entraînement sans enjeu, à votre rythme.
          </Mode>
        )}
        <Mode icon="ui-duel" title="Tutoriel" onClick={() => send({ type: "tutorial" })}>
          Un duel guidé pour apprendre les bases. Première victoire : 1 booster.
        </Mode>
        <Mode icon="ui-booster" title="Mode Scellé" onClick={() => go("scelle")}>
          Six boosters rien que pour la session, un deck, jusqu'à 3 victoires ou 2 défaites.
        </Mode>
        <Mode icon="ui-histoire" title="Mode Histoire" onClick={() => go("histoire")}>
          <StoryLine arcs={state.story} />
        </Mode>
        <Mode icon="ui-eclair" title="Puzzles" onClick={() => go("puzzles")}>
          <PuzzleLine puzzles={state.puzzles} />
        </Mode>
        <Mode icon="ui-trophee" title="La Tour" onClick={() => go("tour")}>
          {state.tower ? towerLine(state.tower) : "10 étages contre le bot, de plus en plus difficiles."}
        </Mode>
        <Mode icon="ui-booster" title="Boosters" badge={state.boosters?.pending} onClick={() => go("boosters")}>
          <BoosterLine boosters={state.boosters} />
        </Mode>
        <Mode icon="ui-cartes" title="Collection et decks" onClick={() => go("collection")}>
          {state.collection ? `${state.collection.reduce((sum, [, quantity]) => sum + quantity, 0)} cartes` : "Vos cartes"}
          {deck && ` · deck actif : ${deck.name}`}
        </Mode>
      </div>
      {star !== undefined && <Projector code={star} />}
    </div>
  );
}

type CodeFormProps = { id: string; action: string; className: string; send: (room: string) => void };

// A room code and the button that uses it.
function CodeForm({ id, action, className, send }: Readonly<CodeFormProps>) {
  return (
    <form
      className="rejoindre"
      onSubmit={(event) => {
        event.preventDefault();
        send((new FormData(event.currentTarget).get("room") as string).trim().toUpperCase());
      }}
    >
      <label className="sr" htmlFor={id}>
        Code de la salle
      </label>
      <input id={id} name="room" className="saisie-code" required maxLength={5} placeholder="Code" autoComplete="off" />
      <button type="submit" className={className}>
        {action}
      </button>
    </form>
  );
}

type ModeProps = { icon: string; title: string; badge?: number; onClick: () => void; children: ReactNode };

// A button holds phrasing content only: the mode is laid out with spans.
function Mode({ icon, title, badge = 0, onClick, children }: Readonly<ModeProps>) {
  return (
    <button type="button" className="mode" data-entree onClick={onClick}>
      <Icon id={icon} className="mode__ic" />
      <span>
        <span className="mode__titre">
          {title} {badge > 0 && <span className="pastille">{badge}</span>}
        </span>
        <span className="mode__desc">{children}</span>
      </span>
      <Icon id="ui-suivant" className="mode__fleche" />
    </button>
  );
}

// The special rule of the week: its rules, and a duel under it against the bot or in an online room.
function EventCard({ event, send }: Readonly<{ event: NonNullable<LobbyState["event"]>; send: Send }>) {
  const [choosingLevel, setChoosingLevel] = useState(false);
  const [rule] = specialRules([event.rule]);
  if (!rule) return null;
  const reward = event.won ? "Booster de la semaine déjà gagné." : "Première victoire de la semaine : 1 booster.";
  return (
    <article className="mode mode--principal mode--evenement" data-entree>
      <div className="mode__tete">
        <Icon id="ui-histoire" className="mode__ic" />
        <div>
          <h2>Événement : {rule.name}</h2>
          <p>
            {event.lp} LP, {event.hand} cartes en main. {reward}
          </p>
        </div>
      </div>
      <RuleBlock rule={rule} />
      <div className="mode__actions">
        {choosingLevel ? (
          <>
            {BOT_LEVELS.map(([level, label]) => (
              <button key={level} type="button" className="btn" onClick={() => send({ type: "bot", level, event: true })}>
                {label}
              </button>
            ))}
            <button type="button" className="btn btn--fantome" onClick={() => setChoosingLevel(false)}>
              Retour
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setChoosingLevel(true)}>
              Contre le bot
            </button>
            <button type="button" className="btn btn--holo" onClick={() => send({ type: "create", event: true })}>
              Créer une salle
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function StoryLine({ arcs }: Readonly<{ arcs?: StoryArcView[] }>) {
  const arc = arcs && currentArc(arcs);
  if (!arc) return "Les grands duels de l'anime, arc par arc.";
  const plural = arc.won > 1 ? "s" : "";
  return (
    <>
      {arc.title} · {arc.won} duel{plural} gagné{plural} sur {arc.total}
      <span className="jauge" style={{ "--v": `${(arc.won / arc.total) * 100}%` } as CSSProperties} />
    </>
  );
}

function PuzzleLine({ puzzles }: Readonly<{ puzzles?: PuzzleView[] }>) {
  if (!puzzles) return "Des situations à gagner en un seul tour.";
  const solved = puzzles.filter((puzzle) => puzzle.done).length;
  return `${solved} réussi${solved > 1 ? "s" : ""} sur ${puzzles.length} · gagnez en un seul tour`;
}

function BoosterLine({ boosters }: Readonly<{ boosters?: LobbyState["boosters"] }>) {
  const now = useNow();
  if (!boosters) return "Ouvrez vos boosters, une carte à la fois.";
  const remaining = countdown(boosters.nextFreeAt, now);
  const count = boosters.pending;
  let pending = "";
  if (count > 0) pending = `${count} booster${count > 1 ? "s" : ""} à ouvrir · `;
  if (!remaining) return `${pending}booster gratuit disponible`;
  return (
    <>
      {pending}prochain gratuit dans <b className="chiffres">{remaining}</b>
    </>
  );
}

// The card on the Duel Disk projects its monster as a hologram.
function Projector({ code }: Readonly<{ code: number }>) {
  const { cards } = useDuelView();
  const info = cards.get(code);
  return (
    <>
      <div className="projecteur" aria-hidden="true" data-entree>
        {info?.image && (
          <div className="projecteur__holo">
            <img src={`/api/art/${code}.jpg`} alt="" />
          </div>
        )}
        <div className="projecteur__faisceau" />
        <div className="projecteur__socle">
          <CardView code={code} rarity="ultra" />
        </div>
      </div>
      <p className="projecteur__legende">
        <span className="surtitre">Carte phare du deck actif</span>
        <b>{cardName(cards, code)}</b>
        {info && (
          <span className="chiffres">
            ATK {stat(info.atk)} · DEF {stat(info.def)}
          </span>
        )}
      </p>
    </>
  );
}

type SalleProps = { room: string; pseudo: string; decks?: DeckList; leave: () => void };

// Private room waiting for the second player.
export function Salle({ room, pseudo, decks, leave }: Readonly<SalleProps>) {
  const [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState(false);
  const deck = activeDeck(decks);
  const link = inviteLink(location.origin, room);
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(done),
      () => {
        setCopied("");
        setFallback(true);
      },
    );
  };
  return (
    <div className="salle">
      <p className="surtitre" data-entree>
        Salle privée
      </p>
      <h1 className="titre" data-entree>
        En attente de l'adversaire
      </h1>
      <p className="texte-2" data-entree>
        Partagez ce code : le duel commence dès que votre adversaire rejoint la salle.
      </p>
      <div className="code-salle" data-entree>
        <span className="code-salle__lettres chiffres">
          <span className="sr">Code {room}</span>
          {[...Array(room.length).keys()].map((i) => (
            <span key={i} aria-hidden="true">
              {room[i]}
            </span>
          ))}
        </span>
        <button type="button" className="btn btn--holo" onClick={() => copy(room, "Code copié.")}>
          <Icon id="ui-copier" />
          Copier le code
        </button>
        <button type="button" className="btn btn--holo" onClick={() => copy(link, "Lien copié.")}>
          <Icon id="ui-copier" />
          Copier le lien
        </button>
      </div>
      {fallback && (
        <input className="saisie-code" readOnly value={link} aria-label="Lien d'invitation" onFocus={(event) => event.currentTarget.select()} />
      )}
      <p className={copied ? "message message--succes" : "sr"} role="status">
        {copied}
      </p>
      <div className="face-a-face" data-entree>
        <div className="duelliste">
          <span className="avatar avatar--grand" aria-hidden="true">
            {pseudo.charAt(0).toUpperCase()}
          </span>
          <b>{pseudo}</b>
          <span className="texte-2">{deck ? `${deck.name} · ${deck.main.length} cartes` : "Deck actif"}</span>
          <span className="puce puce--succes">
            <Icon id="ui-coche" />
            Prêt
          </span>
        </div>
        <span className="vs" aria-hidden="true">
          VS
        </span>
        <div className="duelliste duelliste--attente">
          <span className="radar" aria-hidden="true" />
          <b>Place libre</b>
          <span className="texte-2">Recherche de l'adversaire…</span>
        </div>
      </div>
      <button type="button" className="btn btn--fantome" data-entree onClick={leave}>
        Quitter la salle
      </button>
    </div>
  );
}
