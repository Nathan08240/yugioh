import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, DeckResult, DuelMode, StoryArcView } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, useDuelView } from "./cards.ts";
import { filterCollection, noFilters, ownedCodes, setProgress, type Kind } from "./collection.ts";
import { tally } from "./DeckRecord.tsx";
import type { LobbyState } from "./lobby.ts";
import "./styles/profil.css";
import { Avatar } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;

const ROWS: { label: string; mode?: DuelMode; level?: string }[] = [
  { label: "Total" },
  { label: "En ligne", mode: "online" },
  { label: "Bot débutant", mode: "bot", level: "debutant" },
  { label: "Bot normal", mode: "bot", level: "normal" },
  { label: "Bot expert", mode: "bot", level: "expert" },
  { label: "Histoire", mode: "story" },
];
// Cards shown at once in a picker: the search narrows a large collection.
const PICKER_MAX = 60;
const STARS_PER_DUEL = 3;

// Stars won over the most the story gives (3 per duel).
export function storyStars(arcs: readonly StoryArcView[]) {
  const duels = arcs.flatMap((arc) => arc.duels);
  return { stars: duels.reduce((sum, duel) => sum + duel.stars, 0), max: duels.length * STARS_PER_DUEL };
}

// Share of the pool the player owns, rounded down so that 100 means complete; `sets` are the passcodes of each set.
export function completion(sets: readonly (readonly number[])[], collection: [number, number][]) {
  return setProgress([...new Set(sets.flat())], ownedCodes(collection));
}

function Bilan({ results }: Readonly<{ results?: DeckResult[] }>) {
  if (!results) return <p className="texte-2">Chargement des statistiques…</p>;
  return (
    <table className="profil__bilan">
      <caption className="titre-bloc">Victoires et défaites</caption>
      <thead>
        <tr>
          <th scope="col">Mode</th>
          <th scope="col">Victoires</th>
          <th scope="col">Défaites</th>
          <th scope="col">Taux</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(({ label, mode, level }) => {
          const { wins, losses, percent } = tally(results, undefined, mode, level);
          return (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="chiffres">{wins}</td>
              <td className="chiffres">{losses}</td>
              <td className="chiffres">{percent === undefined ? "—" : `${percent} %`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type PickerProps = { title: string; collection: [number, number][]; kind: Kind; artOnly: boolean; pick: (code: number) => void; close: () => void };

// Search over the owned cards; an avatar needs an artwork to show.
function Selecteur({ title, collection, kind, artOnly, pick, close }: Readonly<PickerProps>) {
  const { cards } = useDuelView();
  const [query, setQuery] = useState("");
  const list = useMemo(
    () =>
      filterCollection(collection, cards, { ...noFilters, name: query, kind })
        .filter(([code]) => !artOnly || cards.get(code)?.image)
        .slice(0, PICKER_MAX),
    [collection, cards, query, kind, artOnly],
  );
  return (
    <section className="panneau selecteur" aria-label={title}>
      <div className="selecteur__tete">
        <h2 className="titre-bloc">{title}</h2>
        <button type="button" className="btn btn--fantome" onClick={close}>
          Fermer
        </button>
      </div>
      <label className="sr" htmlFor="selecteur-recherche">
        Rechercher parmi vos cartes
      </label>
      <input id="selecteur-recherche" className="selecteur__recherche" type="search" placeholder="Rechercher une carte" value={query} onChange={(event) => setQuery(event.target.value)} />
      {list.length === 0 && <p className="texte-2">Aucune carte possédée ne correspond.</p>}
      <ul className="selecteur__liste">
        {list.map(([code]) => (
          <li key={code}>
            <button type="button" title={cardName(cards, code)} aria-label={cardName(cards, code)} onClick={() => pick(code)}>
              {cards.get(code)?.image ? <img src={`/api/art/${code}.jpg`} alt="" loading="lazy" /> : <span>{cardName(cards, code)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type ViewProps = { state: LobbyState; sets?: readonly (readonly number[])[]; send: Send };

// The profile screen once its data is there: `sets` are the passcodes of each set of the pool.
export function ProfilView({ state, sets, send }: Readonly<ViewProps>) {
  const [picking, setPicking] = useState<"avatar" | "favorite">();
  const pseudo = state.pseudo ?? "";
  const favorite = state.profile?.favorite ?? undefined;
  const story = state.story && storyStars(state.story);
  const owned = state.collection && sets && completion(sets, state.collection);
  const pick = (code: number) => {
    send({ type: picking === "avatar" ? "set_avatar" : "set_favorite", code });
    setPicking(undefined);
  };
  return (
    <div className="profil">
      <div className="profil__tete" data-entree>
        <Avatar name={pseudo} code={state.profile?.avatar ?? undefined} className="avatar--profil" />
        <div>
          <p className="surtitre">Profil</p>
          <h1 className="titre">{pseudo}</h1>
        </div>
        <div className="profil__actions">
          <button type="button" className="btn" disabled={!state.collection} onClick={() => setPicking("avatar")}>
            Changer d'avatar
          </button>
          <button type="button" className="btn" disabled={!state.collection} onClick={() => setPicking("favorite")}>
            Carte favorite
          </button>
        </div>
      </div>
      {picking && state.collection && (
        <Selecteur title={picking === "avatar" ? "Choisir un avatar" : "Choisir la carte favorite"} collection={state.collection} kind={picking === "avatar" ? "monster" : ""} artOnly={picking === "avatar"} pick={pick} close={() => setPicking(undefined)} />
      )}
      <div className="profil__grille">
        <section className="panneau profil__bloc" data-entree>
          <Bilan results={state.results} />
        </section>
        <section className="panneau profil__bloc profil__progres" data-entree>
          <h2 className="titre-bloc">Progression</h2>
          <p>
            Étoiles de l'histoire : <b className="chiffres">{story ? `${story.stars} / ${story.max}` : "…"}</b>
          </p>
          <p>
            Collection complétée : <b className="chiffres">{owned ? `${owned.percent} %` : "…"}</b>
            {owned && <span className="texte-3"> ({owned.owned} cartes sur {owned.total})</span>}
          </p>
        </section>
        <section className="panneau profil__bloc profil__favorite" data-entree>
          <h2 className="titre-bloc">Carte favorite</h2>
          {favorite === undefined ? <p className="texte-2">Aucune carte favorite choisie.</p> : <CardView code={favorite} />}
        </section>
      </div>
    </div>
  );
}

// The screen of the player: avatar, favorite card, statistics and progression.
export function Profil({ state, send }: Readonly<{ state: LobbyState; send: Send }>) {
  const [sets, setSets] = useState<number[][]>();
  // Once per visit: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "player_profile" });
    send({ type: "collection" });
    send({ type: "duel_results" });
    send({ type: "story" });
    fetch("/api/sets")
      .then((res) => res.json())
      .then((data: { cards: number[] }[]) => setSets(data.map((set) => set.cards)))
      .catch((error: unknown) => console.error(error));
  }, []);
  return <ProfilView state={state} sets={sets} send={send} />;
}
