import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClientMessage, PuzzleView } from "../../server/src/protocol.ts";
import { Accueil, Salle } from "./Accueil.tsx";
import { AlertesAmis, Amis } from "./Amis.tsx";
import { Boosters } from "./Boosters.tsx";
import { Classe } from "./Classe.tsx";
import { Draft } from "./Draft.tsx";
import { DuelView, useCards } from "./cards.ts";
import { Collection } from "./Collection.tsx";
import { OffreTutoriel, PseudoForm, StarterChoice } from "./Depart.tsx";
import { Duel } from "./Duel.tsx";
import { Fin, FinSpectateur } from "./Fin.tsx";
import { initialLobby, inviteFromUrl, reduce, type Action, type LobbyState } from "./lobby.ts";
import { Parametres } from "./Parametres.tsx";
import { Profil } from "./Profil.tsx";
import { puzzleRule, Puzzles } from "./Puzzles.tsx";
import { autoAnswer } from "./question.ts";
import { reglages } from "./reglages.ts";
import { duelRules, Regles } from "./regles.tsx";
import { ApercuSalle } from "./SalleOptions.tsx";
import { Scelle } from "./Scelle.tsx";
import { Shell, type Page } from "./Shell.tsx";
import { duelLabel, duelLp, duelSpecial, Story } from "./Story.tsx";
import { supabase } from "./supabase.ts";
import { Tour } from "./Tour.tsx";

// Same origin as the page: Vite proxies /ws to the game server in dev.
const SERVER_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

type Send = (msg: ClientMessage) => void;

// Room of an invitation link (to play or to watch), kept until the player can join (after login, pseudo and starter).
let invite = inviteFromUrl(location.href);

// Messages that open a room outside the ranked queue.
const NOT_RANKED: ReadonlySet<string> = new Set(["create", "join", "room_rules", "bot", "story_duel", "puzzle", "tower_duel", "sealed_duel", "draft_duel", "challenge", "challenge_reply"]);

export function Lobby() {
  const [state, dispatch] = useReducer(reduce, initialLobby);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<Page>("accueil");
  const socket = useRef<WebSocket>(null);
  const rejoin = useRef<string>(undefined);
  // Rooms against the bot (story duels included) earn no booster.
  const vsBot = useRef(false);
  const storyDuel = useRef<string>(undefined);
  const storyEasy = useRef(false);
  const puzzleId = useRef<string>(undefined);
  const sealedDuel = useRef(false);
  const draftDuel = useRef(false);
  // The next or current room comes from the ranked queue: no rematch, a rating change at the end.
  const ranked = useRef(false);
  const tutorial = useRef(false);
  const cards = useCards();
  const view = useMemo(() => ({ cards, show: () => {}, seat: 0 }), [cards]);

  useEffect(() => {
    const ws = new WebSocket(SERVER_URL);
    socket.current = ws;
    ws.onopen = () => {
      // The token never goes in the URL: it is the first message.
      supabase.auth.getSession().then(({ data }) => {
        ws.send(JSON.stringify({ type: "auth", token: data.session?.access_token ?? "" } satisfies ClientMessage));
        if (rejoin.current) ws.send(JSON.stringify({ type: "join", room: rejoin.current } satisfies ClientMessage));
      });
    };
    ws.onmessage = (event) => {
      const msg: Action = JSON.parse(event.data);
      // The tutorial shows every chain it can answer, whatever the settings.
      const auto = msg.type === "question" ? autoAnswer(msg.question, tutorial.current ? "auto" : reglages().chaines) : undefined;
      if (auto) ws.send(JSON.stringify({ type: "respond", response: auto } satisfies ClientMessage));
      // A standard room needs no acceptance: joining goes on, a custom one asks the player first.
      else if (msg.type === "room_rules" && !msg.options) ws.send(JSON.stringify({ type: "join", room: msg.room } satisfies ClientMessage));
      else dispatch(msg);
    };
    ws.onclose = () => dispatch({ type: "closed" });
    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [attempt]);

  const ready = state.pseudo != null && !state.needsStarter;
  useEffect(() => {
    if (!ready || !invite || state.room) return;
    // A room to play in shows its custom rules first (see room_rules).
    socket.current?.send(JSON.stringify(invite.type === "join" ? ({ type: "room_rules", room: invite.room } satisfies ClientMessage) : invite));
    invite = undefined;
    history.replaceState(null, "", location.pathname);
  }, [ready]);
  // The avatar is shown on the plate of the duel, whatever screen the player came from.
  useEffect(() => {
    if (ready) socket.current?.send(JSON.stringify({ type: "player_profile" } satisfies ClientMessage));
  }, [ready]);

  const send: Send = (msg) => {
    if (msg.type === "bot" || msg.type === "story_duel" || msg.type === "puzzle" || msg.type === "tower_duel" || msg.type === "sealed_duel" || msg.type === "draft_duel" || msg.type === "tutorial") {
      vsBot.current = true;
      sealedDuel.current = msg.type === "sealed_duel";
      draftDuel.current = msg.type === "draft_duel";
      tutorial.current = msg.type === "tutorial";
    }
    // The tutorial is offered once, right after the starter.
    if (msg.type === "starter") setPage("tutoriel");
    if (msg.type === "puzzle") puzzleId.current = msg.id;
    if (msg.type === "story_duel") {
      storyDuel.current = msg.duel;
      storyEasy.current = msg.level === "facile";
    }
    if (msg.type === "create" || msg.type === "join" || msg.type === "room_rules" || msg.type === "challenge" || msg.type === "challenge_reply" || msg.type === "ranked_queue") {
      vsBot.current = false;
      sealedDuel.current = false;
      draftDuel.current = false;
      tutorial.current = false;
    }
    if (msg.type === "ranked_queue") ranked.current = true;
    else if (NOT_RANKED.has(msg.type)) ranked.current = false;
    // The races of an ANNOUNCE_RACE response are bigints: they travel as strings.
    socket.current?.send(JSON.stringify(msg, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value)));
  };
  const reconnect = () => {
    rejoin.current = state.room;
    dispatch({ type: "connecting" });
    setAttempt(attempt + 1);
  };
  // A new connection leaves the room: the server keeps a seat per connection.
  const leave = () => {
    rejoin.current = undefined;
    dispatch({ type: "left" });
    dispatch({ type: "connecting" });
    setAttempt(attempt + 1);
  };
  const respond = (response: OcgResponse) => {
    send({ type: "respond", response });
    dispatch({ type: "answered" });
  };
  // The story screen stays open across its duels: it lives in the lobby state.
  const go = (next: Page) => {
    dispatch({ type: "story_menu", open: next === "histoire" });
    if (next !== "histoire") setPage(next);
  };

  const shown = state.storyOpen ? "histoire" : page;
  // A puzzle is only played from its screen.
  const puzzle = shown === "puzzles" ? state.puzzles?.find((candidate) => candidate.id === puzzleId.current) : undefined;
  return (
    <DuelView value={view}>
      {state.error && (
        <p className="message message--erreur alerte-globale" role="alert">
          {state.error}
        </p>
      )}
      {state.maintenance && !state.error && (
        <p className="message alerte-globale alerte-globale--info" role="status">
          Mise à jour en cours : les nouveaux duels reprennent dans quelques minutes. Les duels en cours continuent jusqu'à leur fin.
        </p>
      )}
      <AlertesAmis state={state} send={send} />
      <ApercuSalle preview={state.preview} send={send} close={() => dispatch({ type: "preview_close" })} />
      <Screen state={state} page={shown} send={send} reconnect={reconnect} leave={leave} respond={respond} go={go} vsBot={vsBot.current} ranked={ranked.current} storyDuel={storyDuel.current} easy={storyEasy.current} puzzle={puzzle} sealedDuel={sealedDuel.current} draftDuel={draftDuel.current} tutorial={tutorial.current} />
    </DuelView>
  );
}

type ScreenProps = {
  state: LobbyState;
  page: Page;
  send: Send;
  reconnect: () => void;
  leave: () => void;
  respond: (response: OcgResponse) => void;
  go: (page: Page) => void;
  vsBot: boolean;
  ranked: boolean;
  storyDuel?: string;
  easy: boolean;
  puzzle?: PuzzleView;
  sealedDuel: boolean;
  draftDuel: boolean;
  tutorial: boolean;
};

const signOut = () => {
  supabase.auth.signOut();
};

function Screen({ state, page, send, reconnect, leave, respond, go, vsBot, ranked, storyDuel, easy, puzzle, sealedDuel, draftDuel, tutorial }: Readonly<ScreenProps>) {
  if (state.closed) {
    return (
      <Shell id="perdu">
        <div className="ecran-message">
          <p>Connexion au serveur perdue.</p>
          <button type="button" className="btn" onClick={reconnect}>
            Se reconnecter
          </button>
        </div>
      </Shell>
    );
  }
  if (state.pseudo === undefined) {
    return (
      <Shell id="attente">
        <p className="ecran-message">Connexion au serveur…</p>
      </Shell>
    );
  }
  if (state.pseudo === null) {
    return (
      <Shell id="pseudo" signOut={signOut}>
        <PseudoForm send={send} />
      </Shell>
    );
  }
  if (state.needsStarter) {
    return (
      <Shell id="starter" pseudo={state.pseudo} signOut={signOut}>
        <StarterChoice send={send} />
      </Shell>
    );
  }
  if (state.room && state.started && state.board) {
    const special = state.storyOpen ? duelSpecial(state.story, storyDuel) : (state.special ?? []);
    const story = state.storyOpen ? { title: duelLabel(state.story, storyDuel), won: state.won, special, easy, lp: duelLp(state.story, storyDuel) } : undefined;
    const leaveFor = (next: Page) => {
      leave();
      go(next);
    };
    const tower = state.floor === undefined ? undefined : { floor: state.floor, won: state.towerWon };
    const report = { send: (message: string) => send({ type: "report", message: message || undefined }), sent: state.reported };
    // A spectator sees seat 0's side, and can neither answer, surrender, send an emote nor report.
    const watching = state.spectating;
    const me = watching ?? { name: state.pseudo, avatar: state.profile?.avatar ?? undefined };
    return (
      <>
        <Duel board={state.board} seat={state.seat ?? 0} asked={state.question} respond={respond} leave={leave} surrender={() => send({ type: "surrender" })} emotes={state.emotes} sendEmote={watching ? undefined : (id) => send({ type: "emote", id })} report={watching ? undefined : report} answerBy={state.answerBy} away={state.away} feed={state.feed} lp={state.lp} opponentLp={state.opponentLp} pseudo={me.name} opponent={state.opponent} avatar={me.avatar} opponentAvatar={state.opponentAvatar} rules={puzzle ? puzzleRule(puzzle) : duelRules(special, state.options)} easy={state.storyOpen && easy} kingdom={special.includes("duelist-kingdom")} spectateur={watching !== undefined} spectators={state.spectators} tutoriel={tutorial} />
        {watching && state.board.winner !== undefined && <FinSpectateur board={state.board} names={[watching.name ?? "Joueur 1", state.opponent ?? "Joueur 2"]} room={state.room} leave={leave} />}
        {!watching && state.board.winner !== undefined && <Fin board={state.board} seat={state.seat ?? 0} room={state.room} vsBot={vsBot} ranked={ranked ? { result: state.rankedResult } : undefined} opponent={state.opponent} story={story} eventBooster={state.eventWon} puzzle={puzzle && { title: puzzle.title, booster: state.solved?.booster }} tutoriel={tutorial ? { booster: state.solved?.booster } : undefined} tower={tower} rematch={state.rematch} onRematch={(accept) => send({ type: "rematch", accept })} sealed={sealedDuel ? (state.sealed ?? undefined) : undefined} draft={draftDuel ? (state.draft ?? undefined) : undefined} report={report} leave={leave} go={leaveFor} />}
      </>
    );
  }
  if (state.room) {
    return (
      <Shell id="salle" pseudo={state.pseudo}>
        <Salle room={state.room} pseudo={state.pseudo} decks={state.decks} leave={leave} />
      </Shell>
    );
  }
  return (
    <Shell id={page} background={page === "collection" ? "nuit" : "ville"} pseudo={state.pseudo} page={page} go={go} pending={state.boosters?.pending} requests={state.friends?.filter((friend) => friend.status === "received").length} signOut={signOut} notice={page === "accueil"}>
      {page === "accueil" && <Accueil state={state} send={send} go={go} />}
      {page === "classe" && <Classe state={state} send={send} go={go} />}
      {page === "collection" && <Collection collection={state.collection} rarities={state.rarities} decks={state.decks} results={state.results} wishlist={state.wishlist} points={state.points} conversion={state.conversion} send={send} />}
      {page === "boosters" && <Boosters state={state} send={send} go={go} />}
      {page === "histoire" && <Story arcs={state.story} send={send} />}
      {page === "puzzles" && <Puzzles puzzles={state.puzzles} send={send} />}
      {page === "tour" && <Tour tower={state.tower} send={send} />}
      {page === "regles" && <Regles jouerTutoriel={() => send({ type: "tutorial" })} />}
      {page === "tutoriel" && <OffreTutoriel send={send} go={go} />}
      {page === "profil" && <Profil state={state} send={send} />}
      {page === "amis" && <Amis state={state} send={send} />}
      {page === "parametres" && <Parametres />}
      {page === "scelle" && <Scelle run={state.sealed} send={send} go={go} />}
      {page === "draft" && <Draft run={state.draft} send={send} go={go} />}
    </Shell>
  );
}
