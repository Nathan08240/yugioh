import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { Accueil, Salle } from "./Accueil.tsx";
import { Boosters } from "./Boosters.tsx";
import { DuelView, useCards } from "./cards.ts";
import { DeckBuilder } from "./DeckBuilder.tsx";
import { PseudoForm, StarterChoice } from "./Depart.tsx";
import { Duel } from "./Duel.tsx";
import { Fin } from "./Fin.tsx";
import { initialLobby, reduce, type Action, type LobbyState } from "./lobby.ts";
import { autoAnswer } from "./question.ts";
import { Shell, type Page } from "./Shell.tsx";
import { Story } from "./Story.tsx";
import { supabase } from "./supabase.ts";

// Same origin as the page: Vite proxies /ws to the game server in dev.
const SERVER_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

type Send = (msg: ClientMessage) => void;

export function Lobby() {
  const [state, dispatch] = useReducer(reduce, initialLobby);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<Page>("accueil");
  const socket = useRef<WebSocket>(null);
  const rejoin = useRef<string>(undefined);
  // Rooms against the bot (story duels included) earn no booster.
  const vsBot = useRef(false);
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
      const auto = msg.type === "question" ? autoAnswer(msg.question) : undefined;
      if (auto) ws.send(JSON.stringify({ type: "respond", response: auto } satisfies ClientMessage));
      else dispatch(msg);
    };
    ws.onclose = () => dispatch({ type: "closed" });
    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [attempt]);

  const send: Send = (msg) => {
    if (msg.type === "bot" || msg.type === "story_duel") vsBot.current = true;
    if (msg.type === "create" || msg.type === "join") vsBot.current = false;
    socket.current?.send(JSON.stringify(msg));
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

  return (
    <DuelView value={view}>
      {state.error && (
        <p className="message message--erreur alerte-globale" role="alert">
          {state.error}
        </p>
      )}
      <Screen state={state} page={state.storyOpen ? "histoire" : page} send={send} reconnect={reconnect} leave={leave} respond={respond} go={go} vsBot={vsBot.current} />
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
};

const signOut = () => {
  supabase.auth.signOut();
};

function Screen({ state, page, send, reconnect, leave, respond, go, vsBot }: Readonly<ScreenProps>) {
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
    const story = state.storyOpen ? { won: state.won } : undefined;
    const leaveFor = (next: Page) => {
      leave();
      go(next);
    };
    return (
      <>
        <Duel board={state.board} seat={state.seat ?? 0} asked={state.question} respond={respond} leave={leave} />
        {state.board.winner !== undefined && <Fin board={state.board} seat={state.seat ?? 0} room={state.room} vsBot={vsBot} story={story} leave={leave} go={leaveFor} />}
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
    <Shell id={page} background={page === "collection" ? "nuit" : "ville"} pseudo={state.pseudo} page={page} go={go} pending={state.boosters?.pending} signOut={signOut} notice={page === "accueil"}>
      {page === "accueil" && <Accueil state={state} send={send} go={go} />}
      {page === "collection" && <DeckBuilder collection={state.collection} decks={state.decks} send={send} />}
      {page === "boosters" && <Boosters state={state} send={send} go={go} />}
      {page === "histoire" && <Story arcs={state.story} send={send} close={() => go("accueil")} />}
    </Shell>
  );
}
