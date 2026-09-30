import { useEffect, useState, type FormEvent } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { CardView } from "./Card.tsx";
import { cardName, strongest, useDuelView } from "./cards.ts";
import type { Page } from "./Shell.tsx";
import "./styles/depart.css";
import { Icon } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;
type Starter = "yugi" | "kaiba";
type Starters = Record<Starter, number[]>;

const STARTERS: [Starter, string, string][] = [
  ["yugi", "Yugi", "Magiciens, guerriers et pièges : un deck souple qui retourne le duel au bon moment."],
  ["kaiba", "Kaiba", "Dragons et monstres puissants : frapper fort, et vite, avec le Dragon Blanc aux Yeux Bleus."],
];

// First step after the account: the pseudo, final.
export function PseudoForm({ send }: Readonly<{ send: Send }>) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send({ type: "pseudo", pseudo: (new FormData(event.currentTarget).get("pseudo") as string).trim() });
  };
  return (
    <div className="depart">
      <form className="panneau panneau--holo depart__form" data-entree onSubmit={submit}>
        <p className="surtitre">Bienvenue à Battle City</p>
        <h1 className="titre-panneau">Choisissez votre pseudo</h1>
        <label className="champ">
          <span>Pseudo</span>
          <span className="champ__saisie">
            <Icon id="ui-joueur" />
            <input name="pseudo" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_\-]+" autoComplete="nickname" />
          </span>
          <span className="champ__aide">3 à 20 caractères : lettres sans accent, chiffres, _ ou -. Il ne pourra plus être changé.</span>
        </label>
        <button type="submit" className="btn btn--grand">
          Valider
        </button>
      </form>
    </div>
  );
}

// Last step before the first duel: Yugi's or Kaiba's starter deck, final.
export function StarterChoice({ send }: Readonly<{ send: Send }>) {
  const [starters, setStarters] = useState<Starters>();

  useEffect(() => {
    fetch("/api/starters")
      .then((res) => res.json())
      .then(setStarters)
      .catch((error: unknown) => console.error(error));
  }, []);

  return (
    <div className="starter">
      <div className="starter__tete" data-entree>
        <p className="surtitre">Dernière étape avant votre premier duel</p>
        <h1 className="titre">Choisissez votre deck de départ</h1>
        <p className="texte-2">Choix définitif : ses cartes rejoignent votre collection et il devient votre deck actif.</p>
      </div>
      {starters && (
        <div className="starter__choix" data-entree>
          {STARTERS.map(([id, name, pitch]) => (
            <StarterOption key={id} id={id} name={name} pitch={pitch} codes={starters[id]} onChoose={() => send({ type: "starter", starter: id })} />
          ))}
        </div>
      )}
    </div>
  );
}

// Right after the starter, once: the guided duel of the tutorial, which the player may decline.
export function OffreTutoriel({ send, go }: Readonly<{ send: Send; go: (page: Page) => void }>) {
  const jouer = () => {
    go("accueil");
    send({ type: "tutorial" });
  };
  return (
    <div className="depart">
      <section className="panneau panneau--holo depart__form" aria-labelledby="offre-tutoriel" data-entree>
        <p className="surtitre">Deck choisi</p>
        <h1 id="offre-tutoriel" className="titre-panneau">
          Apprendre les bases ?
        </h1>
        <p className="texte-2">Un duel guidé de quelques minutes : invoquer, attaquer, poser un Piège, l'enchaîner. Première victoire : 1 booster. Il reste disponible depuis l'accueil et la page Règles.</p>
        <button type="button" className="btn btn--grand" onClick={jouer}>
          Jouer le tutoriel
        </button>
        <button type="button" className="btn btn--fantome" onClick={() => go("accueil")}>
          Plus tard
        </button>
      </section>
    </div>
  );
}

type OptionProps = { id: Starter; name: string; pitch: string; codes: number[]; onChoose: () => void };

function StarterOption({ id, name, pitch, codes, onChoose }: Readonly<OptionProps>) {
  const { cards } = useDuelView();
  const best = strongest(codes, cards, 5);
  // The strongest card in the middle of the fan, the others on each side.
  const fan = [best[3], best[1], best[0], best[2], best[4]].filter((code) => code !== undefined);
  return (
    <article className={`deck-depart deck-depart--${id}`}>
      <div className="deck-depart__cartes" aria-hidden="true">
        {fan.map((code) => (
          <CardView key={code} code={code} rarity={code === best[0] ? "ultra" : undefined} />
        ))}
      </div>
      <div className="deck-depart__texte">
        <p className="surtitre">Starter Deck</p>
        <h2>{name}</h2>
        <p>{pitch}</p>
        <ul className="puces">
          <li className="puce">{codes.length} cartes</li>
          {best.slice(0, 2).map((code) => (
            <li key={code} className="puce">
              {cardName(cards, code)}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--grand" onClick={onChoose}>
          Choisir le deck de {name}
        </button>
      </div>
    </article>
  );
}
