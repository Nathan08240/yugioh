import { useEffect, useRef } from "react";
import "./styles/histoire.css";

// `name`: the short name of a special rule, for titles.
export type Rule = { title: string; details: string[]; name?: string };

// Special rules of the story data (server/src/story.ts EXTRA_RULES), as the player reads them.
const RULES = new Map<string, Rule>([
  [
    "duelist-kingdom",
    {
      title: "Règles du Royaume des Duellistes",
      name: "Royaume des Duellistes",
      details: [
        "Pas d'attaque directe.",
        "Invocation Normale possible en Position de Défense face recto.",
        "Monstres de niveau 5 ou plus invoqués sans Sacrifice.",
        "Un monstre détruit par un effet inflige à son contrôleur la moitié de son ATK.",
        "Un seul monstre peut attaquer par tour.",
        "Qui finit son tour sans monstre et sans en avoir invoqué perd le duel.",
      ],
    },
  ],
  [
    "battle-city",
    {
      title: "Règles de Battle City",
      name: "Battle City",
      details: [
        "Invocation Normale possible en Position de Défense face recto.",
        "Les monstres de niveau 10 ou plus demandent 3 Sacrifices.",
        "Pendant la Battle Phase, les Magies se jouent comme des Magies Jeu-Rapide.",
        "Un monstre invoqué depuis l'Extra Deck ne peut pas attaquer le tour de son invocation.",
        "Une Magie ou un Piège détruit pendant son activation perd son effet.",
      ],
    },
  ],
  [
    "virtual-world",
    {
      title: "Règles du Monde virtuel",
      name: "Monde virtuel",
      details: [
        "Chaque duelliste choisit un Deck Master en début de duel, gardé hors du deck.",
        "Pendant sa Main Phase, on peut l'Invoquer Spécialement depuis l'extérieur du duel.",
        "Qui n'a plus de Deck Master perd le duel : sur le terrain, il peut être détruit.",
        "Un monstre sacrifié transmet son rôle au monstre invoqué grâce à lui.",
        "Aucun monstre ne se pose face verso : il arrive face recto en Position de Défense.",
        "Seuls Total Defense Shogun et Super Roboyarou ont leur pouvoir de Deck Master.",
      ],
    },
  ],
]);

// The rules of the game as played here: Goat format (April 2005), 4000 LP.
const BASICS: Rule[] = [
  {
    title: "Le duel",
    details: [
      "Chaque duelliste commence avec 4000 LP et 5 cartes en main.",
      "On gagne quand les LP de l'adversaire tombent à 0, ou quand il doit piocher dans un deck vide.",
      "Les règles sont celles du format Goat, d'avril 2005.",
    ],
  },
  {
    title: "La liste des cartes limitées",
    details: [
      "La liste TCG d'avril 2005 interdit certaines cartes, en limite d'autres à 1 exemplaire (limitées) ou à 2 (semi-limitées).",
      "Elle s'applique seulement en mode Classé et dans les duels de l'événement de la semaine, contre le bot comme en salle en ligne.",
      "Dans tous les autres modes, chaque carte reste permise en 3 exemplaires.",
      "Un deck qui dépasse la liste ne peut pas entrer en Classé ni en événement : le constructeur de deck indique combien de cartes sont en trop.",
    ],
  },
  {
    title: "Le tour",
    details: [
      "Draw Phase : on pioche 1 carte.",
      "Standby Phase : se jouent les effets et coûts de début de tour.",
      "Main Phase 1 : on Invoque, on Pose, on joue ses Magies et ses Pièges.",
      "Battle Phase : les monstres attaquent.",
      "Main Phase 2 : comme la Main Phase 1, sans attaque.",
      "End Phase : fin du tour. Avec plus de 6 cartes en main, on défausse le surplus.",
    ],
  },
  {
    title: "Invoquer un monstre",
    details: [
      "Une Invocation Normale ou une Pose par tour, depuis la main.",
      "Niveau 4 ou moins : aucun Sacrifice.",
      "Niveau 5 ou 6 : 1 Sacrifice. Niveau 7 ou plus : 2 Sacrifices.",
      "Un Sacrifice est un monstre de votre Terrain envoyé au Cimetière.",
      "Une Invocation Spéciale vient d'un effet et ne compte pas dans la limite du tour.",
    ],
  },
  {
    title: "Positions",
    details: [
      "Position d'Attaque : face recto, à la verticale. Le monstre peut attaquer.",
      "Position de Défense : face recto, couché. Il ne peut pas attaquer.",
      "Face verso : un monstre Posé est face cachée en Défense. Il se retourne en Invocation-Flip ou quand il est attaqué.",
      "On change la position d'un monstre une fois par tour, sauf le tour où il est arrivé.",
    ],
  },
  {
    title: "Combat",
    details: [
      "Un monstre attaque une fois par tour. Sans monstre en face, il attaque directement les LP.",
      "Attaque contre Attaque : le plus faible est détruit, son contrôleur perd la différence d'ATK. À égalité, les deux sont détruits.",
      "Attaque contre Défense : si l'ATK dépasse la DEF, le défenseur est détruit sans dégâts. Sinon, l'attaquant perd la différence en LP.",
      "Un monstre face verso est retourné avant le calcul des dégâts.",
    ],
  },
  {
    title: "Magies et Pièges",
    details: [
      "Une Magie s'active pendant votre Main Phase. Un Piège se Pose face verso et s'active à partir du tour suivant.",
      "Magie Continue, Équipement ou Terrain : elle reste sur le Terrain. Magie Normale : elle va au Cimetière après usage.",
      "Vitesse 1 : Magies Normales, Continues, Équipement, Terrain et Rituel. Vitesse 2 : Jeu-Rapide, Pièges Normaux et Continus. Vitesse 3 : Contre-Pièges.",
      "Quand une carte s'active, l'adversaire peut répondre avec une carte de vitesse égale ou supérieure : c'est une chaîne, qui se résout en partant de la dernière carte jouée.",
    ],
  },
  {
    title: "Fusion et Rituel",
    details: [
      "Fusion : jouez Polymérisation, envoyez au Cimetière les monstres demandés par le monstre de Fusion, puis Invoquez-le Spécialement depuis l'Extra Deck.",
      "Rituel : jouez la Magie Rituel, Sacrifiez des monstres de la main ou du Terrain dont les Niveaux égalent au moins celui du monstre Rituel, puis Invoquez-le Spécialement depuis la main.",
    ],
  },
];

// Every rule of the game, for the Rules page: the basics, then the special rules of each story arc.
export const allRules = (): Rule[] => [...BASICS, ...RULES.values()];

// The rules to show for the `special` names of a story duel.
export const specialRules = (names: readonly string[]): Rule[] => names.flatMap((name) => RULES.get(name) ?? []);

export function RuleBlock({ rule, open }: Readonly<{ rule: Rule; open?: boolean }>) {
  return (
    <details className="regles panneau" open={open} data-entree>
      <summary>{rule.title}</summary>
      <ul>
        {rule.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </details>
  );
}

// During a duel: a badge that opens the same list as the briefing.
export function RulesBadge({ rules }: Readonly<{ rules: Rule[] }>) {
  const details = useRef<HTMLDetailsElement>(null);
  // Escape or a press outside closes the list, and Escape gives the focus back to the badge.
  useEffect(() => {
    const el = details.current;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !el.open) return;
      el.open = false;
      el.querySelector("summary")?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (!el.contains(event.target as Node)) el.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  return (
    <details ref={details} className="regles-duel">
      <summary className="puce puce--or">Règles spéciales</summary>
      <div className="regles-duel__liste">
        {rules.map((rule) => (
          <RuleBlock key={rule.title} rule={rule} open />
        ))}
      </div>
    </details>
  );
}

// The Rules page: basics open, story arc rules folded.
export function Regles({ jouerTutoriel }: Readonly<{ jouerTutoriel: () => void }>) {
  return (
    <div className="regles-page">
      <div data-entree>
        <p className="surtitre">Aide</p>
        <h1 className="titre">Règles</h1>
      </div>
      <p className="regles-tutoriel" data-entree>
        <span className="texte-2">Les bases en pratique, pas à pas, contre le bot.</span>
        <button type="button" className="btn" onClick={jouerTutoriel}>
          Jouer le tutoriel
        </button>
      </p>
      {allRules().map((rule) => (
        <RuleBlock key={rule.title} rule={rule} open={BASICS.includes(rule)} />
      ))}
    </div>
  );
}
