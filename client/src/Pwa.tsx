import { mettreAJour, usePwa } from "./pwa.ts";

// A new version of the game is ready: the player picks the moment to reload (never in the middle of a duel, see Lobby).
export function BandeauMiseAJour() {
  const { miseAJour } = usePwa();
  if (!miseAJour) return null;
  return (
    <div className="alertes-amis alerte-maj" aria-live="polite">
      <div className="panneau alerte-ami" role="status">
        <p>Une nouvelle version du jeu est disponible.</p>
        <div className="alerte-ami__actions">
          <button type="button" className="btn" onClick={mettreAJour}>
            Mettre à jour
          </button>
        </div>
      </div>
    </div>
  );
}
