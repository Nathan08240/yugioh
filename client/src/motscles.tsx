import { useId, useMemo, useState } from "react";

type Keyword = {
  id: string;
  label: string;
  // Words of the type line (monster race, kinds, spell and trap kinds), matched whole.
  type?: string[];
  // Lowercase fragments searched in the card text.
  text?: string[];
  help: string;
};

// Plain string search on a fixed list: every term was checked against the French texts of the card pool.
const KEYWORDS: Keyword[] = [
  { id: "effet", label: "Effet", type: ["Effet"], help: "Monstre dont le texte décrit un effet, à activer ou permanent." },
  { id: "flip", label: "Flip", type: ["Flip"], text: ["flip"], help: "Effet qui se déclenche quand le monstre est retourné face recto : Invocation-Flip, ou attaque subie face verso." },
  { id: "fusion", label: "Fusion", type: ["Fusion"], text: ["fusion"], help: "Monstre de l'Extra Deck, Invoqué en jouant Polymérisation avec les monstres que sa carte demande." },
  { id: "rituel", label: "Rituel", type: ["Rituel"], text: ["rituel"], help: "Monstre Invoqué depuis la main avec sa Magie Rituel, en Sacrifiant des monstres dont les Niveaux égalent au moins le sien." },
  { id: "spirit", label: "Spirit", type: ["Spirit"], help: "Retourne dans la main à la fin du tour où il a été Invoqué ou retourné." },
  { id: "union", label: "Union", type: ["Union"], help: "Peut s'équiper sur un monstre du Terrain pour le renforcer, puis se détacher." },
  { id: "gemeau", label: "Gémeau", type: ["Gémeau"], help: "Compte comme un monstre Normal. Une seconde Invocation Normale sur lui lui donne ses effets." },
  { id: "continue", label: "Continue", type: ["Continue", "Continu"], help: "Reste face recto sur le Terrain après son activation et agit tant qu'elle y est." },
  { id: "jeu-rapide", label: "Jeu-Rapide", type: ["Jeu-Rapide"], help: "Magie de vitesse 2 : elle s'active aussi pendant le tour adverse si elle est Posée depuis un tour, et peut répondre à une chaîne." },
  { id: "equipement", label: "Équipement", type: ["Equipement", "Équipement"], help: "Magie attachée à un monstre pour le modifier. Elle est détruite si ce monstre quitte le Terrain." },
  { id: "terrain", label: "Terrain", type: ["Terrain"], help: "Magie placée dans la zone Terrain : elle modifie le duel tant qu'elle y reste." },
  { id: "contre", label: "Contre-Piège", type: ["Contre"], help: "Piège de vitesse 3 : seul un autre Contre-Piège peut lui répondre." },
  { id: "normale", label: "Invocation Normale", text: ["invocation normale", "invoquer normalement"], help: "Une par tour : on Invoque ou on Pose un monstre depuis la main. Niveau 5 ou 6 : 1 Sacrifice. Niveau 7 ou plus : 2 Sacrifices." },
  { id: "speciale", label: "Invocation Spéciale", text: ["invocation spéciale", "spécialement"], help: "Invocation permise par un effet. Elle ne compte pas dans l'Invocation Normale du tour." },
  { id: "sacrifice", label: "Sacrifice", text: ["sacrifi"], help: "Envoyer un de vos monstres au Cimetière, pour en Invoquer un plus fort ou payer un effet." },
  { id: "banni", label: "Banni", text: ["banni"], help: "Retiré du duel : la carte ne passe pas par le Cimetière et n'y revient pas sans effet." },
  { id: "cimetiere", label: "Cimetière", text: ["cimetière"], help: "Pile face recto des cartes détruites, Sacrifiées, défaussées ou utilisées." },
  { id: "verso", label: "Face verso", text: ["face verso"], help: "Carte posée côté dos : un monstre ainsi posé est en Position de Défense, et l'adversaire ne voit pas sa carte." },
  { id: "jeton", label: "Jeton", text: ["jeton"], help: "Monstre créé par un effet, sans carte. Il disparaît du duel en quittant le Terrain." },
  { id: "main", label: "Main Phase", text: ["main phase"], help: "Phase où l'on Invoque, Pose et active des cartes. Il y en a deux par tour, avant et après la Battle Phase." },
  { id: "battle", label: "Battle Phase", text: ["battle phase"], help: "Phase où vos monstres attaquent." },
  { id: "damage", label: "Damage Step", text: ["damage step"], help: "Moment du combat où les dégâts sont calculés : presque aucune carte ne peut s'y activer." },
];

// The keywords of a card, read in its type line and its text.
export function findKeywords(typeLine: string, desc: string): Keyword[] {
  const words = new Set(typeLine.replaceAll("/", " ").split(" ").filter(Boolean));
  const text = desc.toLowerCase();
  return KEYWORDS.filter((word) => word.type?.some((term) => words.has(term)) || word.text?.some((term) => text.includes(term)));
}

// Chips with their explanation on hover and focus (one shared tooltip: it never overflows the scrolling detail panels).
export function KeywordChips({ typeLine, desc }: Readonly<{ typeLine: string; desc: string }>) {
  const tip = useId();
  const [active, setActive] = useState<string>();
  const keywords = useMemo(() => findKeywords(typeLine, desc), [typeLine, desc]);
  if (keywords.length === 0) return null;
  const shown = keywords.find((word) => word.id === active);
  const hide = (id: string) => setActive((current) => (current === id ? undefined : current));
  return (
    <div className="mots">
      <ul className="puces" aria-label="Mots-clés">
        {keywords.map((word) => (
          <li key={word.id}>
            <button
              type="button"
              className="puce mot"
              aria-describedby={shown === word ? tip : undefined}
              onMouseEnter={() => setActive(word.id)}
              onMouseLeave={() => hide(word.id)}
              onFocus={() => setActive(word.id)}
              onBlur={() => hide(word.id)}
              onClick={() => setActive(word.id)}
              onKeyDown={(event) => event.key === "Escape" && setActive(undefined)}
            >
              {word.label}
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <p id={tip} role="tooltip" className="mot__bulle">
          {shown.help}
        </p>
      )}
    </div>
  );
}
