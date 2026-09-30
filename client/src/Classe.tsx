import { useEffect } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { activeDeck, useNow } from "./Accueil.tsx";
import { useDuelView } from "./cards.ts";
import { GoatReminder } from "./goat.tsx";
import { minutes, type LobbyState } from "./lobby.ts";
import "./styles/classe.css";
import type { Page } from "./Shell.tsx";
import { Avatar } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const games = (count: number) => `${count} partie${count > 1 ? "s" : ""}`;

// The rating of the player, the search for an opponent and the leaderboard.
export function ClasseView({ state, send, now, go }: Readonly<{ state: LobbyState; send: Send; now: number; go: (page: Page) => void }>) {
  const { ranked, rankedSince } = state;
  const { cards } = useDuelView();
  return (
    <div className="classe">
      <div className="classe__tete" data-entree>
        <p className="surtitre">Mode classé</p>
        <h1 className="titre">Classement {ranked ? <span className="chiffres">{ranked.rating}</span> : "…"}</h1>
        <p className="texte-2">{ranked ? games(ranked.games) : "Chargement…"} · un adversaire de votre niveau, avec votre deck actif. Le gagnant reçoit un booster.</p>
        <GoatReminder deck={activeDeck(state.decks)} cards={cards} where="en classé" go={() => go("collection")} />
        {rankedSince === undefined ? (
          <button type="button" className="btn btn--grand" onClick={() => send({ type: "ranked_queue" })}>
            Chercher un adversaire
          </button>
        ) : (
          <div className="classe__attente">
            <p role="status">
              {/* minutes() counts down to its first argument: from the start of the search, it counts up. */}
              Recherche d'un adversaire… <b className="chiffres">{minutes(now, rankedSince)}</b>
            </p>
            <button type="button" className="btn btn--fantome" onClick={() => send({ type: "ranked_cancel" })}>
              Annuler
            </button>
          </div>
        )}
      </div>
      <section className="panneau classe__bloc" data-entree>
        <table className="classe__table">
          <caption className="titre-bloc">Meilleurs joueurs</caption>
          <thead>
            <tr>
              <th scope="col">Rang</th>
              <th scope="col">Joueur</th>
              <th scope="col">Classement</th>
              <th scope="col">Parties</th>
            </tr>
          </thead>
          <tbody>
            {ranked?.leaderboard.map((player, index) => (
              <tr key={player.pseudo} aria-current={player.pseudo === state.pseudo || undefined}>
                <td className="chiffres">{index + 1}</td>
                <th scope="row">
                  <Avatar name={player.pseudo} code={player.avatar ?? undefined} />
                  {player.pseudo}
                </th>
                <td className="chiffres">{player.rating}</td>
                <td className="chiffres">{player.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ranked?.leaderboard.length === 0 && <p className="texte-2">Aucun duel classé joué pour l'instant.</p>}
      </section>
    </div>
  );
}

export function Classe({ state, send, go }: Readonly<{ state: LobbyState; send: Send; go: (page: Page) => void }>) {
  const now = useNow();
  // Once per visit: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "ranked" });
    send({ type: "decks" });
  }, []);
  return <ClasseView state={state} send={send} now={now} go={go} />;
}
