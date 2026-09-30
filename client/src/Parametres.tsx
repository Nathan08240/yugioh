import { useReglages, type Reglages } from "./reglages.ts";
import "./styles/parametres.css";

type GroupeProps<K extends keyof Reglages> = { cle: K; titre: string; aide: string; choix: readonly (readonly [Reglages[K], string])[] };

// One setting as a group of radio buttons; the choice is kept at once.
function Groupe<K extends keyof Reglages>({ cle, titre, aide, choix }: Readonly<GroupeProps<K>>) {
  const [valeurs, regler] = useReglages();
  return (
    <fieldset className="reglage panneau" aria-describedby={`aide-${cle}`} data-entree>
      <legend className="titre-bloc">{titre}</legend>
      <p id={`aide-${cle}`} className="texte-2">
        {aide}
      </p>
      <div className="reglage__choix">
        {choix.map(([valeur, libelle]) => (
          <label key={valeur}>
            <input type="radio" name={cle} value={valeur} checked={valeurs[cle] === valeur} onChange={() => regler({ [cle]: valeur } as Pick<Reglages, K>)} />
            <span>{libelle}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Settings kept in this browser (reglages.ts).
export function Parametres() {
  return (
    <div className="parametres">
      <div data-entree>
        <p className="surtitre">Ce navigateur</p>
        <h1 className="titre">Paramètres</h1>
      </div>
      <Groupe
        cle="vitesse"
        titre="Vitesse des animations"
        aide="Raccourcit les animations et les pauses des duels, des boosters et des changements d'écran. Instantanée les supprime."
        choix={[
          ["normale", "Normale"],
          ["rapide", "Rapide"],
          ["instantanee", "Instantanée"],
        ]}
      />
      <Groupe
        cle="mouvement"
        titre="Réduire les animations"
        aide="Auto suit le réglage de votre système. Réduites, les animations laissent place à de simples fondus."
        choix={[
          ["auto", "Auto"],
          ["toujours", "Toujours"],
          ["jamais", "Jamais"],
        ]}
      />
      <Groupe
        cle="qualite"
        titre="Qualité du plateau 3D"
        aide="Basse allège le rendu sur les machines peu puissantes. En Haute, la qualité baisse d'elle-même si le duel rame."
        choix={[
          ["haute", "Haute"],
          ["basse", "Basse"],
        ]}
      />
      <Groupe
        cle="emotes"
        titre="Afficher les émotes de l'adversaire"
        aide="Les phrases que votre adversaire envoie pendant un duel s'affichent près de son nom. Les vôtres restent toujours visibles."
        choix={[
          ["oui", "Oui"],
          ["non", "Non"],
        ]}
      />
    </div>
  );
}
