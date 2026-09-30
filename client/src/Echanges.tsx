import { useEffect, useRef, useState, type ReactNode } from "react";
import { TRADES_PER_DAY, type ClientMessage, type TradeOffer } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, useDuelView, type Cards } from "./cards.ts";
import type { LobbyState } from "./lobby.ts";
import { prefersReduced } from "./motion.ts";
import "./styles/echanges.css";

type Send = (msg: ClientMessage) => void;

// "3 h", never below 1 h: an offer still listed has not expired.
const hoursLeft = (expiresAt: string, now: number) => `${Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 3_600_000))} h`;

function Carte({ code, label }: Readonly<{ code: number; label: string }>) {
  const { cards } = useDuelView();
  return (
    <span className="echange__carte">
      <CardView code={code} />
      <span className="texte-3">{label}</span>
      <b>{cardName(cards, code)}</b>
    </span>
  );
}

function Offre({ offer, now, children }: Readonly<{ offer: TradeOffer; now: number; children: ReactNode }>) {
  return (
    <li className="echange">
      <p className="echange__titre">
        <b>{offer.pseudo}</b> <span className="texte-3">expire dans {hoursLeft(offer.expiresAt, now)}</span>
      </p>
      <div className="echange__cartes">
        <Carte code={offer.give} label="Vous donnez" />
        <span className="echange__fleche" aria-hidden="true">
          ⇄
        </span>
        <Carte code={offer.get} label="Vous recevez" />
      </div>
      <span className="ami__actions">{children}</span>
    </li>
  );
}

// Offers received and sent, with the trades left today.
export function Echanges({ trades, send, now = Date.now() }: Readonly<{ trades: LobbyState["trades"]; send: Send; now?: number }>) {
  if (!trades || (trades.received.length === 0 && trades.sent.length === 0)) return null;
  const remove = (offer: TradeOffer, label: string) => (
    <button type="button" className="btn btn--fantome" onClick={() => send({ type: "trade_remove", id: offer.id })}>
      {label}
    </button>
  );
  return (
    <section className="panneau amis__bloc" aria-label="Échanges de cartes" data-entree>
      <h2 className="titre-bloc">
        Échanges de cartes <span className="chiffres texte-3">{`${trades.left} / ${TRADES_PER_DAY} restants aujourd'hui`}</span>
      </h2>
      {trades.received.length > 0 && (
        <>
          <h3 className="echange__sous-titre">Offres reçues</h3>
          <ul className="amis__liste">
            {trades.received.map((offer) => (
              <Offre key={offer.id} offer={offer} now={now}>
                <button type="button" className="btn" disabled={trades.left === 0} onClick={() => send({ type: "trade_accept", id: offer.id })}>
                  Accepter
                </button>
                {remove(offer, "Refuser")}
              </Offre>
            ))}
          </ul>
        </>
      )}
      {trades.sent.length > 0 && (
        <>
          <h3 className="echange__sous-titre">Offres envoyées</h3>
          <ul className="amis__liste">
            {trades.sent.map((offer) => (
              <Offre key={offer.id} offer={offer} now={now}>
                {remove(offer, "Annuler")}
              </Offre>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type ChoixProps = { name: string; title: string; empty: string; cards: [number, number][]; chosen?: number; choose: (code: number) => void; wished?: ReadonlySet<number> };

function Choix({ name, title, empty, cards, chosen, choose, wished }: Readonly<ChoixProps>) {
  const view = useDuelView();
  return (
    <fieldset className="echange__choix">
      <legend className="echange__sous-titre">{title}</legend>
      {cards.length === 0 && <p className="texte-2">{empty}</p>}
      <ul className="echange__grille">
        {cards.map(([code, spare]) => (
          <li key={code}>
            <label className={`echange__option${wished?.has(code) ? " est-souhaitee" : ""}`}>
              <input type="radio" name={name} className="sr" checked={chosen === code} onChange={() => choose(code)} />
              <CardView code={code} />
              <b className="echange__nom">{cardName(view.cards, code)}</b>
              <span className="chiffres texte-3">{`${spare} à échanger`}</span>
              {wished?.has(code) && <span className="echange__souhait">♥ Souhaitée</span>}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

// Cards by name, those the player wishes for first.
function sorted(list: [number, number][], cards: Cards, wished: ReadonlySet<number>): [number, number][] {
  const key = ([code]: [number, number]) => `${wished.has(code) ? 0 : 1}${cardName(cards, code)}`;
  return list.toSorted((a, b) => key(a).localeCompare(key(b), "fr"));
}

type PropositionProps = { pseudo: string; tradeCards: LobbyState["tradeCards"]; wishlist?: number[]; send: Send; close: () => void };

// Offer to a friend: one copy of a card with copies to spare, for one of theirs.
export function Proposition({ pseudo, tradeCards, wishlist, send, close }: Readonly<PropositionProps>) {
  const { cards } = useDuelView();
  const panel = useRef<HTMLElement>(null);
  const [give, setGive] = useState<number>();
  const [get, setGet] = useState<number>();
  const wished = new Set(wishlist);
  const ready = tradeCards?.pseudo === pseudo ? tradeCards : undefined;
  // The panel opens above the list of friends, out of sight from the button.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start", behavior: prefersReduced() ? "auto" : "smooth" });
  }, [pseudo]);
  return (
    <section ref={panel} className="panneau amis__bloc" aria-label={`Proposer un échange à ${pseudo}`}>
      <h2 className="titre-bloc">Échange avec {pseudo}</h2>
      <p className="texte-2">Un exemplaire contre un exemplaire. Chacun garde toujours son dernier exemplaire et ceux qu'utilisent ses decks.</p>
      {ready ? (
        <div className="echange__choix-liste">
          <Choix name="donner" title="Vous donnez" empty="Aucun doublon à échanger." cards={sorted(ready.mine, cards, new Set())} chosen={give} choose={setGive} />
          <Choix name="recevoir" title={`Vous recevez de ${pseudo}`} empty={`${pseudo} n'a aucun doublon à échanger.`} cards={sorted(ready.theirs, cards, wished)} chosen={get} choose={setGet} wished={wished} />
        </div>
      ) : (
        <p className="texte-2">Chargement des doublons…</p>
      )}
      <div className="ami__actions">
        <button
          type="button"
          className="btn btn--holo"
          disabled={give === undefined || get === undefined}
          onClick={() => {
            if (give === undefined || get === undefined) return;
            send({ type: "trade_offer", pseudo, give, get });
            close();
          }}
        >
          Proposer l'échange
        </button>
        <button type="button" className="btn btn--fantome" onClick={close}>
          Annuler
        </button>
      </div>
    </section>
  );
}
