import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { initialLobby, reduce, type LobbyState } from "./lobby.ts";
import { supabase } from "./supabase.ts";

// Same origin as the page: Vite proxies /ws to the game server in dev.
const SERVER_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const DECKS = ["Yugi", "Kaiba"];

type Send = (msg: ClientMessage) => void;

// Reads one text field from a submitted form.
function field(event: FormEvent<HTMLFormElement>, name: string): string {
  event.preventDefault();
  return (new FormData(event.currentTarget).get(name) as string).trim();
}

export function Lobby() {
  const [state, dispatch] = useReducer(reduce, initialLobby);
  const [attempt, setAttempt] = useState(0);
  const socket = useRef<WebSocket>(null);
  const rejoin = useRef<string>(undefined);

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
    ws.onmessage = (event) => dispatch(JSON.parse(event.data));
    ws.onclose = () => dispatch({ type: "closed" });
    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [attempt]);

  const send: Send = (msg) => socket.current?.send(JSON.stringify(msg));
  const reconnect = () => {
    rejoin.current = state.room;
    dispatch({ type: "connecting" });
    setAttempt(attempt + 1);
  };

  return (
    <>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <Screen state={state} send={send} reconnect={reconnect} />
    </>
  );
}

function Screen({ state, send, reconnect }: Readonly<{ state: LobbyState; send: Send; reconnect: () => void }>) {
  if (state.closed) {
    return (
      <div className="stack">
        <p>Connexion au serveur perdue.</p>
        <button type="button" onClick={reconnect}>
          Se reconnecter
        </button>
      </div>
    );
  }
  if (state.pseudo === undefined) return <p className="muted">Connexion au serveur…</p>;
  if (state.pseudo === null) return <PseudoForm send={send} />;
  if (!state.room) return <RoomChoice pseudo={state.pseudo} send={send} />;
  const deck = DECKS[state.seat ?? 0];
  if (state.journal.length === 0) return <Waiting room={state.room} deck={deck} />;
  return <Journal room={state.room} deck={deck} journal={state.journal} />;
}

function PseudoForm({ send }: Readonly<{ send: Send }>) {
  return (
    <form className="stack" onSubmit={(event) => send({ type: "pseudo", pseudo: field(event, "pseudo") })}>
      <h2>Choisissez votre pseudo</h2>
      <p className="muted">3 à 20 caractères : lettres sans accent, chiffres, _ ou -. Il ne pourra plus être changé.</p>
      <input name="pseudo" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_\-]+" autoComplete="nickname" />
      <button type="submit">Valider</button>
    </form>
  );
}

function RoomChoice({ pseudo, send }: Readonly<{ pseudo: string; send: Send }>) {
  return (
    <div className="stack">
      <h2>Bienvenue, {pseudo}</h2>
      <button type="button" onClick={() => send({ type: "create" })}>
        Créer une salle
      </button>
      <p className="divider">ou</p>
      <form className="row" onSubmit={(event) => send({ type: "join", room: field(event, "room").toUpperCase() })}>
        <input name="room" required maxLength={5} placeholder="Code de la salle" aria-label="Code de la salle" className="code-input" />
        <button type="submit">Rejoindre</button>
      </form>
    </div>
  );
}

function Waiting({ room, deck }: Readonly<{ room: string; deck: string }>) {
  return (
    <div className="stack center">
      <h2>En attente de l'adversaire</h2>
      <p className="muted">Partagez ce code avec votre adversaire :</p>
      <button
        type="button"
        className="code"
        title="Copier le code"
        onClick={() => {
          navigator.clipboard.writeText(room);
        }}
      >
        {room}
      </button>
      <p className="muted">Vous jouez le deck de {deck}.</p>
    </div>
  );
}

function Journal({ room, deck, journal }: Readonly<{ room: string; deck: string; journal: string[] }>) {
  return (
    <div className="stack">
      <h2>Duel en cours</h2>
      <p className="muted">
        Salle {room}, vous jouez le deck de {deck}. Le plateau arrive bientôt : en attendant, voici les messages du moteur.
      </p>
      <div className="journal">
        <pre>{journal.join("\n")}</pre>
      </div>
    </div>
  );
}
