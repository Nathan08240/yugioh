import { useState } from "react";
import { demander, prises } from "./notifications.ts";
import { installer, usePwa } from "./pwa.ts";
import { useReglages, type Choisi, type Reglages } from "./reglages.ts";
import "./styles/parametres.css";

// `accepter`: asked before a choice is kept, which it refuses by answering false.
type GroupeProps<K extends Choisi> = { cle: K; titre: string; aide: string; choix: readonly (readonly [Reglages[K], string])[]; accepter?: (valeur: Reglages[K]) => Promise<boolean> };

// One setting as a group of radio buttons; the choice is kept at once.
function Groupe<K extends Choisi>({ cle, titre, aide, choix, accepter }: Readonly<GroupeProps<K>>) {
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
            <input type="radio" name={cle} value={valeur} checked={valeurs[cle] === valeur} onChange={async () => {
                if (!accepter || (await accepter(valeur))) regler({ [cle]: valeur } as Pick<Reglages, K>);
              }}
            />
            <span>{libelle}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The volume of the sound effects, 0 to 100.
function Volume() {
  const [{ volume }, regler] = useReglages();
  return (
    <div className="reglage panneau" data-entree>
      <label className="titre-bloc" htmlFor="volume">
        Volume des sons
      </label>
      <p className="texte-2">Les effets sonores sont synthétisés par votre navigateur, sans fichier audio.</p>
      <input id="volume" className="reglage__curseur" type="range" min={0} max={100} step={5} value={volume} onChange={(event) => regler({ volume: Number(event.target.value) })} />
      <output htmlFor="volume" className="chiffres">
        {volume}
      </output>
    </div>
  );
}

// The browser is asked for its permission here, when the player turns the notifications on, and nowhere else.
function Notifications() {
  const [refus, setRefus] = useState(false);
  const accepter = async (valeur: Reglages["notifications"]) => {
    const accepte = valeur === "non" || (await demander());
    setRefus(!accepte);
    return accepte;
  };
  return (
    <>
      <Groupe
        cle="notifications"
        titre="Notifications"
        aide="Quand le jeu reste ouvert en arrière-plan (autre onglet, fenêtre réduite) : défi d'un ami, échange proposé, booster gratuit prêt. Une fois le jeu fermé, il ne peut pas vous prévenir."
        choix={[
          ["oui", "Activées"],
          ["non", "Coupées"],
        ]}
        accepter={accepter}
      />
      {refus && (
        <p className="message message--erreur" role="status">
          {prises() ? "Notifications refusées : autorisez-les pour ce site dans les réglages de votre navigateur, puis réessayez." : "Ce navigateur ne gère pas les notifications."}
        </p>
      )}
    </>
  );
}

// Only when the browser offers the install (pwa.ts): it does not on an installed app, nor on every browser.
function Installation() {
  const { installable } = usePwa();
  if (!installable) return null;
  return (
    <div className="reglage panneau" data-entree>
      <h2 className="titre-bloc">Application</h2>
      <p className="texte-2">Installez le jeu sur cet appareil : une icône sur l'écran d'accueil et un affichage plein écran, sans la barre du navigateur.</p>
      <button type="button" className="btn" onClick={installer}>
        Installer le jeu
      </button>
    </div>
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
        cle="son"
        titre="Effets sonores"
        aide="Sons courts pour la pioche, les invocations, les attaques et la fin du duel. Ils ne démarrent qu'après votre premier clic."
        choix={[
          ["actif", "Activés"],
          ["coupe", "Coupés"],
        ]}
      />
      <Volume />
      <Groupe
        cle="chaines"
        titre="Proposer d'enchaîner"
        aide="Auto ne vous demande que lorsqu'une de vos cartes peut répondre. Jamais passe toute proposition d'enchaîner facultative, sans vous interrompre."
        choix={[
          ["auto", "Auto"],
          ["jamais", "Jamais"],
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
      <Notifications />
      <Installation />
    </div>
  );
}
