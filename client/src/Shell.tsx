import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createQueue, entrance, exit } from "./motion.ts";
import "./styles/shell.css";
import { Icon } from "./ui.tsx";

// "scelle" opens from the home screen only.
export type Page = "accueil" | "collection" | "boosters" | "histoire" | "regles" | "parametres" | "scelle";

const NAV: [Page, string][] = [
  ["accueil", "Accueil"],
  ["collection", "Collection et decks"],
  ["boosters", "Boosters"],
  ["histoire", "Mode Histoire"],
  ["regles", "Règles"],
  ["parametres", "Paramètres"],
];

// Screen transitions have their own queue: they never wait behind the animations of a duel.
const screens = createQueue();

type Props = {
  // A new `id` plays the entrance of the new screen: its [data-entree] blocks rise in cascade.
  id: string;
  background?: "ville" | "nuit" | "scene";
  pseudo?: string;
  // The menu of the screens after login, with the number of boosters to open.
  page?: Page;
  go?: (page: Page) => void;
  pending?: number;
  signOut?: () => void;
  // Source link (AGPL license of the engine) and card ownership notice.
  notice?: boolean;
  children: ReactNode;
};

// Layout of every screen but the duel: background, top bar, transitions.
export function Shell({ id, background = "ville", pseudo, page, go, pending = 0, signOut, notice = false, children }: Readonly<Props>) {
  const body = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (body.current) screens.play(entrance(body.current, sweep.current));
  }, [id]);

  // The current screen leaves before the next one enters.
  const navigate = (next: Page) => {
    if (!go || next === page || !body.current) return;
    screens.skip();
    screens.play(exit(body.current)).then(() => go(next));
  };

  return (
    <div className={`ecran fond-${background}`}>
      <div ref={sweep} className="balayage" aria-hidden="true" />
      {(pseudo !== undefined || signOut) && (
        <header className="barre">
          {go ? (
            <button type="button" className="marque" onClick={() => navigate("accueil")}>
              <Icon id="embleme" />
              Duel Monsters
            </button>
          ) : (
            <span className="marque">
              <Icon id="embleme" />
              Duel Monsters
            </span>
          )}
          {go && (
            <nav className="barre__nav" aria-label="Menu principal">
              {NAV.map(([target, label]) => (
                <button key={target} type="button" aria-current={target === page ? "page" : undefined} onClick={() => navigate(target)}>
                  {label} {target === "boosters" && pending > 0 && <span className="pastille">{pending}</span>}
                </button>
              ))}
            </nav>
          )}
          <div className="barre__joueur">
            {pseudo && (
              <>
                <span className="avatar" aria-hidden="true">
                  {pseudo.charAt(0).toUpperCase()}
                </span>
                <span className="barre__pseudo">{pseudo}</span>
              </>
            )}
            {signOut && (
              <button type="button" className="btn-icone" aria-label="Déconnexion" title="Déconnexion" onClick={signOut}>
                <Icon id="ui-sortie" />
              </button>
            )}
          </div>
        </header>
      )}
      <div key={id} ref={body} className="ecran__corps">
        {children}
      </div>
      {notice && (
        <footer className="mentions">
          <a href="https://github.com/Nathan08240/yugioh" target="_blank" rel="noreferrer">
            Code source
          </a>
          <span>Jeu de fans gratuit, non affilié à Konami. Noms et illustrations des cartes : © Konami.</span>
        </footer>
      )}
    </div>
  );
}
