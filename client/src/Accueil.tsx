import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { SEALED_LOSSES, SEALED_REWARDS, SEALED_WINS, type BotLevel, type ClientMessage, type Deck, type PuzzleView, type StoryArcView } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, stat, strongest, useDuelView } from "./cards.ts";
import { beyondGoat, GoatReminder } from "./goat.tsx";
import { countdown, inviteLink, type DeckList, type LobbyState } from "./lobby.ts";
import { MissionsDuJour } from "./Missions.tsx";
import { RuleBlock, specialRules } from "./regles.tsx";
import { RoomForm } from "./SalleOptions.tsx";
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

export const activeDeck = (decks?: DeckList) => decks?.decks.find((deck) => deck.id === decks.active);

// The arc being played: the first one with a duel left to win, else the last one.
function currentArc(arcs: StoryArcView[]) {
  const arc = arcs.find((candidate) => candidate.duels.some((duel) => duel.status !== "done" && !duel.optional)) ?? arcs.at(-1);
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
    send({ type: "missions" });
    send({ type: "wonder" });
  }, []);

  const [creating, setCreating] = useState(false);
  const deck = activeDeck(state.decks);
  const [star] = useMemo(() => strongest(deck?.main ?? [], cards, 1), [deck, cards]);
  const hour = new Date().getHours();
  const pending = state.boosters?.pending ?? 0;
  return (
    <div className="accueil">
      <header className="accueil__tete">
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
      </header>

      <section className="jouer panneau panneau--holo" aria-labelledby="jouer-titre" data-entree>
        <h2 id="jouer-titre" className="jouer__titre">
          <Icon id="ui-duel" />
          Jouer
        </h2>
        <div className="jouer__choix">
          <article className="jouer__mode">
            <Icon id="ui-bot" className="jouer__ic" />
            <h3>Contre le bot</h3>
            <p>Entraînement sans enjeu, à votre rythme. Choisissez son niveau.</p>
            <div className="jouer__actions">
              {BOT_LEVELS.map(([level, label]) => (
                <button key={level} type="button" className="btn btn--holo" onClick={() => send({ type: "bot", level })}>
                  {label}
                </button>
              ))}
            </div>
          </article>
          <article className="jouer__mode">
            <Icon id="ui-en-ligne" className="jouer__ic" />
            <h3>En ligne</h3>
            <p>Un duel contre un ami, avec votre deck actif. Le gagnant reçoit un booster.</p>
            <div className="jouer__actions">
              <button type="button" className="btn" onClick={() => setCreating(true)}>
                Créer une salle
              </button>
            </div>
          </article>
          <article className="jouer__mode">
            <Icon id="ui-trophee" className="jouer__ic" />
            <h3>Classé</h3>
            <p>
              {state.ranked && <b className="chiffres">Classement {state.ranked.rating} · </b>}
              Un adversaire de votre niveau, classement Elo.
            </p>
            <div className="jouer__actions">
              <button type="button" className="btn btn--holo" onClick={() => go("classe")}>
                Jouer en classé
              </button>
            </div>
          </article>
        </div>
        {creating && (
          <RoomForm title="Règles de la salle" action="Créer la salle" submit={(options) => send({ type: "create", options })} cancel={() => setCreating(false)} />
        )}
        <CodeForm join={(room) => send({ type: "room_rules", room })} watch={(room) => send({ type: "spectate", room })} />
      </section>

      <aside className="accueil__cote">
        {star !== undefined && <Projector code={star} />}
        <MissionsDuJour missions={state.missions?.missions} />
        <Tuile icon="ui-booster" title="Boosters" badge={pending > 0 && <span className="pastille">{pending}</span>} onClick={() => go("boosters")}>
          <BoosterLine boosters={state.boosters} />
        </Tuile>
        <Tuile icon="attr-lumiere" title="Pioche miracle" badge={<WonderBadge wonder={state.wonder} />} onClick={() => go("boosters")}>
          <WonderLine wonder={state.wonder} />
        </Tuile>
      </aside>

      <div className="accueil__suite">
        <StoryCard arcs={state.story} go={() => go("histoire")} />
        {state.event && <EventCard event={state.event} deck={deck} send={send} go={go} />}
      </div>

      <section className="accueil__modes" aria-labelledby="modes-titre">
        <h2 id="modes-titre" className="titre-bloc" data-entree>
          Autres modes
        </h2>
        <div className="tuiles">
          <Tuile icon="ui-duel" title="Tutoriel" badge={<span className="puce puce--or">1re victoire : 1 booster</span>} onClick={() => send({ type: "tutorial" })}>
            Un duel guidé pour apprendre les bases.
          </Tuile>
          <Tuile icon="ui-booster" title="Mode Scellé" badge={<span className="puce puce--or">Jusqu'à {SEALED_BEST} boosters</span>} onClick={() => go("scelle")}>
            Six boosters pour la session, un deck, jusqu'à {SEALED_WINS} victoires ou {SEALED_LOSSES} défaites.
          </Tuile>
          <Tuile icon="ui-cartes" title="Mode Draft" badge={<span className="puce puce--or">Jusqu'à {SEALED_BEST} boosters</span>} onClick={() => go("draft")}>
            Six boosters draftés carte par carte avec trois bots, puis vos duels.
          </Tuile>
          <Tuile icon="ui-eclair" title="Puzzles" onClick={() => go("puzzles")}>
            <PuzzleLine puzzles={state.puzzles} />
          </Tuile>
          <Tuile icon="ui-trophee" title="La Tour" onClick={() => go("tour")}>
            {state.tower ? towerLine(state.tower) : "10 étages contre le bot, de plus en plus difficiles."}
          </Tuile>
          <Tuile icon="ui-cartes" title="Collection et decks" onClick={() => go("collection")}>
            {state.collection ? `${state.collection.reduce((sum, [, quantity]) => sum + quantity, 0)} cartes` : "Vos cartes"}
            {deck && ` · deck actif : ${deck.name}`}
          </Tuile>
        </div>
      </section>
    </div>
  );
}

// Best reward of a Sealed or Draft session.
const SEALED_BEST = SEALED_REWARDS.at(-1);

type CodeFormProps = { join: (room: string) => void; watch: (room: string) => void };

// One room code, to join the room or to watch its duel.
function CodeForm({ join, watch }: Readonly<CodeFormProps>) {
  return (
    <form
      className="rejoindre"
      aria-label="Rejoindre ou regarder avec un code"
      onSubmit={(event) => {
        event.preventDefault();
        const room = (new FormData(event.currentTarget).get("room") as string).trim().toUpperCase();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter?.getAttribute("value") === "regarder") watch(room);
        else join(room);
      }}
    >
      <label className="surtitre" htmlFor="code-salle">
        Code de la salle
      </label>
      <p id="code-salle-aide" className="texte-2">
        Rejoignez la salle d'un ami, ou regardez son duel en spectateur.
      </p>
      <span className="rejoindre__champ">
        <input id="code-salle" name="room" className="saisie-code" required maxLength={5} placeholder="Code" autoComplete="off" aria-describedby="code-salle-aide" />
        <button type="submit" className="btn btn--holo" value="rejoindre">
          Rejoindre
        </button>
        <button type="submit" className="btn btn--fantome" value="regarder">
          <Icon id="ui-oeil" />
          Regarder le duel
        </button>
      </span>
    </form>
  );
}

type TuileProps = { icon: string; title: string; badge?: ReactNode; onClick: () => void; children: ReactNode };

// A mode of the home screen. A button holds phrasing content only: the tile is laid out with spans.
function Tuile({ icon, title, badge, onClick, children }: Readonly<TuileProps>) {
  return (
    <button type="button" className="tuile" data-entree onClick={onClick}>
      <Icon id={icon} className="tuile__ic" />
      <span className="tuile__corps">
        <span className="tuile__titre">
          {title} {badge}
        </span>
        <span className="tuile__desc">{children}</span>
      </span>
      <Icon id="ui-suivant" className="tuile__fleche" />
    </button>
  );
}

// The story arc being played, put forward.
function StoryCard({ arcs, go }: Readonly<{ arcs?: StoryArcView[]; go: () => void }>) {
  const arc = arcs && currentArc(arcs);
  const plural = arc && arc.won > 1 ? "s" : "";
  return (
    <button type="button" className="histoire-vedette" data-entree onClick={go}>
      <span className="surtitre surtitre--or">
        <Icon id="ui-histoire" />
        Mode Histoire
      </span>
      <span className="histoire-vedette__arc">{arc?.title ?? "Les grands duels de l'anime"}</span>
      {arc ? (
        <span className="histoire-vedette__suivi">
          <span className="chiffres">
            {arc.won} duel{plural} gagné{plural} sur {arc.total}
          </span>
          <span className="jauge" style={{ "--v": `${(arc.won / arc.total) * 100}%` } as CSSProperties} />
        </span>
      ) : (
        <span className="texte-2">Arc par arc, avec des decks imposés et des règles spéciales.</span>
      )}
      <span className="histoire-vedette__action">
        {arc?.won ? "Continuer l'histoire" : "Commencer l'histoire"}
        <Icon id="ui-suivant" />
      </span>
    </button>
  );
}

function WonderBadge({ wonder }: Readonly<{ wonder?: LobbyState["wonder"] }>) {
  if (!wonder || wonder.status === "picked") return null;
  return <span className="puce puce--or">{wonder.status === "drawn" ? "En cours" : "Disponible"}</span>;
}

function WonderLine({ wonder }: Readonly<{ wonder?: LobbyState["wonder"] }>) {
  if (wonder?.status === "picked") return "Carte du jour prise. Nouvelle pioche demain.";
  if (wonder?.status === "drawn") return "Votre tirage du jour vous attend.";
  return "Une carte offerte par jour, à choisir à l'aveugle parmi cinq.";
}

// The special rule of the week: its rules, and a duel under it against the bot or in an online room.
function EventCard({ event, deck, send, go }: Readonly<{ event: NonNullable<LobbyState["event"]>; deck?: Deck; send: Send; go: (page: Page) => void }>) {
  const { cards } = useDuelView();
  const [choosingLevel, setChoosingLevel] = useState(false);
  const [rule] = specialRules([event.rule]);
  if (!rule) return null;
  const reward = event.won ? "Booster de la semaine déjà gagné." : "Première victoire de la semaine : 1 booster.";
  const beyond = deck && cards.size > 0 ? beyondGoat(deck, cards) : 0;
  return (
    <section className="evenement panneau" aria-labelledby="evenement-titre" data-entree>
      <p className="surtitre">Événement de la semaine</p>
      <h2 id="evenement-titre" className="titre-panneau">
        {rule.name}
      </h2>
      <p className="texte-2">
        {event.lp} LP, {event.hand} cartes en main. {reward}
      </p>
      <RuleBlock rule={rule} />
      {beyond > 0 && (
        <details className="evenement__goat">
          <summary>Deck actif hors liste Goat</summary>
          <GoatReminder deck={deck} cards={cards} where="en événement" go={() => go("collection")} />
        </details>
      )}
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
    </section>
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
    <div className="vitrine">
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
    </div>
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
