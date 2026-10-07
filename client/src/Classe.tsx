import { useEffect } from "react";
import { ONLINE_BOOSTERS_MAX, SEASON_MIN_GAMES, SEASON_REWARDS, type ClientMessage, type RankedPlayer, type RankedView } from "../../server/src/protocol.ts";
import { activeDeck, useNow } from "./Accueil.tsx";
import { useDuelView } from "./cards.ts";
import { GoatReminder } from "./goat.tsx";
import { minutes, type LobbyState } from "./lobby.ts";
import "./styles/classe.css";
import type { Page } from "./Shell.tsx";
import { Avatar } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const s = (count: number) => (count > 1 ? "s" : "");
const plural = (count: number, word: string) => `${count} ${word}${s(count)}`;
const games = (count: number) => plural(count, "partie");

// "2026-10" -> "d'octobre 2026".
export function ofSeason(season: string): string {
  const [year, month] = season.split("-").map(Number);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return "aeiou".includes(name[0]) ? `d'${name}` : `de ${name}`;
}

// "1400 et plus", then each tier up to the one above.
function tierLabel(index: number): string {
  const [floor] = SEASON_REWARDS[index];
  if (index === 0) return `${floor} et plus`;
  return `${floor} à ${SEASON_REWARDS[index - 1][0] - 1}`;
}

function Leaderboard({ caption, players, me }: Readonly<{ caption: string; players: RankedPlayer[]; me?: string | null }>) {
  return (
    <table className="classe__table">
      <caption className="titre-bloc">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rang</th>
          <th scope="col">Joueur</th>
          <th scope="col">Classement</th>
          <th scope="col">Parties</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player, index) => (
          <tr key={player.pseudo} aria-current={player.pseudo === me || undefined}>
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
  );
}

// The season in progress, its rewards and the last season result of the player.
function Season({ ranked }: Readonly<{ ranked: RankedView }>) {
  const missing = SEASON_MIN_GAMES - ranked.seasonGames;
  const last = ranked.lastResult;
  return (
    <section className="panneau classe__bloc" data-entree>
      <h2 className="titre-bloc">Saison {ofSeason(ranked.season)}</h2>
      <p className="texte-2">
        {plural(ranked.daysLeft, "jour")} restant{s(ranked.daysLeft)} · {plural(ranked.seasonGames, "duel")} cette saison ·{" "}
        {missing > 0 ? `encore ${plural(missing, "duel")} pour la récompense` : "récompense assurée selon votre classement final"}
      </p>
      <ul className="classe__bareme">
        {SEASON_REWARDS.map(([floor, boosters], index) => (
          <li key={floor}>
            {tierLabel(index)} : <b className="chiffres">{plural(boosters, "booster")}</b>
          </li>
        ))}
      </ul>
      <p className="texte-2">
        Récompense de fin de mois selon le classement final, à partir de {SEASON_MIN_GAMES} duels dans la saison. Chaque nouvelle saison rapproche ensuite le classement de 1000 de moitié.
      </p>
      {last && (
        <p>
          Saison {ofSeason(last.season)} : classement final <b className="chiffres">{last.rating}</b> en {plural(last.games, "duel")},{" "}
          {last.boosters > 0 ? `${plural(last.boosters, "booster")} reçu${s(last.boosters)}` : "aucune récompense"}.
        </p>
      )}
    </section>
  );
}

// The rating of the player, the search for an opponent, the season and the leaderboards.
export function ClasseView({ state, send, now, go }: Readonly<{ state: LobbyState; send: Send; now: number; go: (page: Page) => void }>) {
  const { ranked, rankedSince } = state;
  const { cards } = useDuelView();
  return (
    <div className="classe">
      <div className="classe__tete" data-entree>
        <p className="surtitre">Mode classé</p>
        <h1 className="titre">Classement {ranked ? <span className="chiffres">{ranked.rating}</span> : "…"}</h1>
        <p className="texte-2">{ranked ? games(ranked.games) : "Chargement…"} · un adversaire de votre niveau, avec votre deck actif. Le gagnant reçoit un booster, {ONLINE_BOOSTERS_MAX} par jour au plus.</p>
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
      {ranked && <Season ranked={ranked} />}
      <section className="panneau classe__bloc" data-entree>
        <Leaderboard caption="Meilleurs joueurs de la saison" players={ranked?.leaderboard ?? []} me={state.pseudo} />
        {ranked?.leaderboard.length === 0 && <p className="texte-2">Aucun duel classé joué cette saison pour l'instant.</p>}
      </section>
      {ranked?.previousLeaderboard.length ? (
        <section className="panneau classe__bloc" data-entree>
          <Leaderboard caption={`Saison ${ofSeason(ranked.previousSeason)} : les meilleurs`} players={ranked.previousLeaderboard} me={state.pseudo} />
        </section>
      ) : null}
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
