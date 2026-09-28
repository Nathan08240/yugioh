import type { OcgResponse } from "@n1xx1/ocgcore-wasm";
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { Boosters } from "./Boosters.tsx";
import { CardView } from "./Card.tsx";
import { DuelView, useCards } from "./cards.ts";
import { DeckBuilder } from "./DeckBuilder.tsx";
import { Duel } from "./Duel.tsx";
import { initialLobby, reduce, type Action, type LobbyState } from "./lobby.ts";
import { autoAnswer } from "./question.ts";
import { supabase } from "./supabase.ts";

// Same origin as the page: Vite proxies /ws to the game server in dev.
const SERVER_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

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

  const send: Send = (msg) => socket.current?.send(JSON.stringify(msg));
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

  return (
    <>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <Screen state={state} send={send} reconnect={reconnect} leave={leave} respond={respond} />
    </>
  );
}

type ScreenProps = { state: LobbyState; send: Send; reconnect: () => void; leave: () => void; respond: (response: OcgResponse) => void };

function Screen({ state, send, reconnect, leave, respond }: Readonly<ScreenProps>) {
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
  if (state.needsStarter) return <StarterChoice send={send} />;
  if (!state.room) return <Home pseudo={state.pseudo} state={state} send={send} />;
  if (!state.started || !state.board) return <Waiting room={state.room} />;
  return <Duel board={state.board} seat={state.seat ?? 0} asked={state.question} respond={respond} leave={leave} />;
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

type Starters = { yugi: number[]; kaiba: number[] };

function StarterChoice({ send }: Readonly<{ send: Send }>) {
  const [starters, setStarters] = useState<Starters>();
  const cards = useCards();
  const view = useMemo(() => ({ cards, show: () => {}, seat: 0 }), [cards]);

  useEffect(() => {
    fetch("/api/starters")
      .then((res) => res.json())
      .then(setStarters)
      .catch((error: unknown) => console.error(error));
  }, []);

  return (
    <div className="stack">
      <h2>Choisissez votre deck de départ</h2>
      <p className="muted">Choix définitif : vous recevrez ces cartes et ce deck pour commencer à jouer.</p>
      {starters && (
        <DuelView value={view}>
          <StarterOption name="Yugi" codes={starters.yugi} onChoose={() => send({ type: "starter", starter: "yugi" })} />
          <StarterOption name="Kaiba" codes={starters.kaiba} onChoose={() => send({ type: "starter", starter: "kaiba" })} />
        </DuelView>
      )}
    </div>
  );
}

function StarterOption({ name, codes, onChoose }: Readonly<{ name: string; codes: number[]; onChoose: () => void }>) {
  return (
    <section className="stack">
      <h3>{name}</h3>
      <div className="starter-cards">
        {codes.map((code) => (
          <CardView key={code} code={code} />
        ))}
      </div>
      <button type="button" onClick={onChoose}>
        Choisir {name}
      </button>
    </section>
  );
}

type Tab = "play" | "collection" | "boosters";

// Menu after login. Boosters get their own tab with the opening screen.
function Home({ pseudo, state, send }: Readonly<{ pseudo: string; state: LobbyState; send: Send }>) {
  const [tab, setTab] = useState<Tab>("play");
  const current = (value: Tab) => (tab === value ? "page" : undefined);
  return (
    <>
      <nav className="tabs">
        <button type="button" aria-current={current("play")} onClick={() => setTab("play")}>
          Jouer
        </button>
        <button type="button" aria-current={current("collection")} onClick={() => setTab("collection")}>
          Collection et decks
        </button>
        <button type="button" aria-current={current("boosters")} onClick={() => setTab("boosters")}>
          Boosters
        </button>
      </nav>
      {tab === "play" && <RoomChoice pseudo={pseudo} send={send} />}
      {tab === "collection" && <DeckBuilder collection={state.collection} decks={state.decks} send={send} />}
      {tab === "boosters" && <Boosters state={state} send={send} />}
    </>
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

function Waiting({ room }: Readonly<{ room: string }>) {
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
    </div>
  );
}
