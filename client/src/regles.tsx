import "./styles/histoire.css";

export type Rule = { title: string; details: string[] };

// Special rules of the story data (server/src/story.ts EXTRA_RULES), as the player reads them.
const RULES = new Map<string, Rule>([
  [
    "duelist-kingdom",
    {
      title: "Règles du Royaume des Duellistes",
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
  return (
    <details className="regles-duel">
      <summary className="puce puce--or">Règles spéciales</summary>
      <div className="regles-duel__liste">
        {rules.map((rule) => (
          <RuleBlock key={rule.title} rule={rule} open />
        ))}
      </div>
    </details>
  );
}
