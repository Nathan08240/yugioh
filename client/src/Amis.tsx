import { useEffect, useState, type ReactNode } from "react";
import { FRIENDS_MAX, type ClientMessage, type Friend, type Presence } from "../../server/src/protocol.ts";
import { Echanges, Proposition } from "./Echanges.tsx";
import { minutes, type LobbyState } from "./lobby.ts";
import "./styles/amis.css";
import { Avatar } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const PRESENCE: Record<Presence, string> = { online: "En ligne", duel: "En duel", offline: "Hors ligne" };
// How long a friend notice stays on screen.
const NOTICE_TIME = 5000;
const isPresence = (status: Friend["status"]): status is Presence => status !== "sent" && status !== "received";

function Ami({ friend, children }: Readonly<{ friend: Friend; children: ReactNode }>) {
  const presence = isPresence(friend.status) ? friend.status : undefined;
  return (
    <li className="ami">
      <Avatar name={friend.pseudo} code={friend.avatar ?? undefined} />
      <span className="ami__nom">
        <b>{friend.pseudo}</b>
        {presence && <span className={`ami__statut ami__statut--${presence}`}>{PRESENCE[presence]}</span>}
      </span>
      <span className="ami__actions">{children}</span>
    </li>
  );
}

type TradeProps = Partial<Pick<LobbyState, "trades" | "tradeCards" | "wishlist">>;

// The friends screen once the list is there: requests received, trades, friends with their presence, requests sent.
export function AmisView({ friends, send, trades, tradeCards, wishlist }: Readonly<{ friends?: Friend[]; send: Send } & TradeProps>) {
  const [pseudo, setPseudo] = useState("");
  // The friend a trade is being offered to.
  const [partner, setPartner] = useState<string>();
  const received = friends?.filter((friend) => friend.status === "received") ?? [];
  const sent = friends?.filter((friend) => friend.status === "sent") ?? [];
  const accepted = friends?.filter((friend) => isPresence(friend.status)) ?? [];
  const remove = (friend: Friend, label: string) => (
    <button type="button" className="btn btn--fantome" onClick={() => send({ type: "friend_remove", pseudo: friend.pseudo })}>
      {label}
    </button>
  );
  return (
    <div className="amis">
      <p className="surtitre" data-entree>
        Amis {friends && <span className="chiffres">{`${friends.length} / ${FRIENDS_MAX}`}</span>}
      </p>
      <form
        className="amis__ajout"
        data-entree
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: "friend_add", pseudo: pseudo.trim() });
          setPseudo("");
        }}
      >
        <label className="sr" htmlFor="ami-pseudo">
          Pseudo du joueur
        </label>
        <input id="ami-pseudo" className="amis__saisie" required maxLength={20} placeholder="Pseudo" autoComplete="off" value={pseudo} onChange={(event) => setPseudo(event.target.value)} />
        <button type="submit" className="btn">
          Ajouter un ami
        </button>
      </form>
      {!friends && <p className="texte-2">Chargement des amis…</p>}
      {received.length > 0 && (
        <section className="panneau amis__bloc" aria-label="Demandes reçues" data-entree>
          <h2 className="titre-bloc">Demandes reçues</h2>
          <ul className="amis__liste">
            {received.map((friend) => (
              <Ami key={friend.pseudo} friend={friend}>
                <button type="button" className="btn" onClick={() => send({ type: "friend_accept", pseudo: friend.pseudo })}>
                  Accepter
                </button>
                {remove(friend, "Refuser")}
              </Ami>
            ))}
          </ul>
        </section>
      )}
      {partner && <Proposition pseudo={partner} tradeCards={tradeCards} wishlist={wishlist} send={send} close={() => setPartner(undefined)} />}
      <Echanges trades={trades} send={send} />
      {friends && (
        <section className="panneau amis__bloc" aria-label="Mes amis" data-entree>
          <h2 className="titre-bloc">Mes amis</h2>
          {accepted.length === 0 && <p className="texte-2">Ajoutez un ami par son pseudo pour le défier en duel.</p>}
          <ul className="amis__liste">
            {accepted.map((friend) => (
              <Ami key={friend.pseudo} friend={friend}>
                {friend.status === "online" && (
                  <button type="button" className="btn btn--holo" onClick={() => send({ type: "challenge", pseudo: friend.pseudo })}>
                    Défier
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPartner(friend.pseudo);
                    send({ type: "trade_cards", pseudo: friend.pseudo });
                  }}
                >
                  Proposer un échange
                </button>
                {friend.watch && (
                  <button type="button" className="btn" onClick={() => send({ type: "spectate", room: friend.watch ?? "" })}>
                    Regarder
                  </button>
                )}
                {remove(friend, "Retirer")}
              </Ami>
            ))}
          </ul>
        </section>
      )}
      {sent.length > 0 && (
        <section className="panneau amis__bloc" aria-label="Demandes envoyées" data-entree>
          <h2 className="titre-bloc">Demandes envoyées</h2>
          <ul className="amis__liste">
            {sent.map((friend) => (
              <Ami key={friend.pseudo} friend={friend}>
                {remove(friend, "Annuler")}
              </Ami>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function Amis({ state, send }: Readonly<{ state: LobbyState; send: Send }>) {
  // Once per visit: `send` changes on every render of the lobby; the server keeps the list up to date afterwards.
  useEffect(() => {
    send({ type: "friends" });
    send({ type: "trades" });
    send({ type: "wishlist" });
  }, []);
  return <AmisView friends={state.friends} send={send} trades={state.trades} tradeCards={state.tradeCards} wishlist={state.wishlist} />;
}

type AlertsProps = { challenges: LobbyState["challenges"]; notice?: LobbyState["notice"]; send: Send; now: number };

// Challenges received and the last friend notice, over any screen.
export function AlertesView({ challenges, notice, send, now }: Readonly<AlertsProps>) {
  const open = challenges.filter((challenge) => challenge.until > now);
  if (open.length === 0 && !notice) return null;
  return (
    <div className="alertes-amis" aria-live="polite">
      {open.map(({ from, until }) => (
        <div key={from} className="panneau alerte-ami" role="alertdialog" aria-label={`Défi de ${from}`}>
          <p>
            <b>{from}</b> vous défie en duel <span className="chiffres texte-3">{minutes(until, now)}</span>
          </p>
          <div className="alerte-ami__actions">
            <button type="button" className="btn" onClick={() => send({ type: "challenge_reply", pseudo: from, accept: true })}>
              Accepter
            </button>
            <button type="button" className="btn btn--fantome" onClick={() => send({ type: "challenge_reply", pseudo: from, accept: false })}>
              Refuser
            </button>
          </div>
        </div>
      ))}
      {notice && (
        <p key={notice.n} className="panneau alerte-ami" role="status">
          {notice.text}
        </p>
      )}
    </div>
  );
}

export function AlertesAmis({ state, send }: Readonly<{ state: LobbyState; send: Send }>) {
  const [, setTick] = useState(0);
  const [hidden, setHidden] = useState(0);
  const waiting = state.challenges.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(id);
  }, [waiting]);
  // A notice goes away by itself.
  useEffect(() => {
    if (!state.notice) return;
    const n = state.notice.n;
    const id = setTimeout(() => setHidden(n), NOTICE_TIME);
    return () => clearTimeout(id);
  }, [state.notice]);
  const notice = state.notice?.n === hidden ? undefined : state.notice;
  return <AlertesView challenges={state.challenges} notice={notice} send={send} now={Date.now()} />;
}
