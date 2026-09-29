# Charte « Duel Disk »

Battle City, la nuit, vue à travers un Duel Disk : l'interface est une projection holographique posée sur la ville. Couleurs vives de l'anime, rendu d'aujourd'hui. Tout est dessiné par nous : aucun logo, cadre ni visuel Konami.

Voir : `pnpm --filter client exec vite ../design --port 5190`, puis `/` (sommaire de la proposition) ou `/maquette/index.html` (rail à gauche pour changer d'écran, `#planche` pour cartes, raretés et états). Illustrations : `node design/copier-assets.mts <chemin>/server` (dossier `design/assets/`, non versionné).

## Fichiers

- `tokens.css` : tous les jetons (couleurs, polices, espaces, rayons, lueurs, zones du HUD, durées).
- `cartes.css` : le composant carte (cadre, raretés, dos, états), dessiné en `cqi` donc lisible à toute taille.
- `icons.svg` : sprite d'icônes maison, `<svg class="ic"><use href="icons.svg#attr-feu"/></svg>`.
- `maquette/` : les 13 écrans en statique ; `motion/` et `plateau-3d/` : démos du mouvement et du plateau 3D (`motion.md`, `3d.md`).

## Couleurs

| Rôle | Jetons |
| --- | --- |
| Nuit (fonds) | `--nuit-0` à `--nuit-3`, `--horizon` (violet au pied de la ville), `--surface` (panneau translucide) |
| Signature | `--holo` cyan du Duel Disk (sélection, focus, liens), `--or` du Millénium (action principale, gains) |
| Camps du duel | `--camp-moi` cyan, `--camp-adverse` corail : plaques, zones, maillons, faisceau d'attaque |
| États | `--succes`, `--danger` (perte de LP, attaque subie), `--alerte`, `--inactif` |
| Attributs | `--attr-lumiere`, `-tenebres`, `-terre`, `-eau`, `-feu`, `-vent`, `-divin` |
| Types (cadre) | `--type-normal`, `-effet`, `-rituel`, `-fusion`, `-magie`, `-piege`, `-jeton` |
| Raretés | `--rar-commune`, `-rare`, `-super`, `-ultra`, `-ultimate`, `-secret`, dégradés `--degrade-argent`, `-or`, `-prisme` |

Thème sombre uniquement. Texte courant `--texte-2` au minimum sur fond nuit (contraste AA), `--texte-3` réservé aux mentions.

## Typographies (Google Fonts)

- **Tektur** (titres, en capitales, `font-stretch` 75 à 88 %) : titres d'écran, noms de mode, VICTOIRE.
- **Barlow** : texte courant, récits du mode Histoire.
- **Barlow Condensed** : libellés, boutons, noms de cartes, sur-titres espacés.
- **Oxanium** : tous les chiffres (LP, ATK/DEF, niveaux, codes de salle, compteurs), en chiffres tabulaires. Derrière les LP, les segments éteints « 8888 » rappellent l'afficheur du Duel Disk.

## Grille, espaces, formes

- Base 4 px : `--e-1` (4) à `--e-8` (64). Marge d'écran `--marge-ecran`, largeur max 1440 px, desktop 1440x900 et 1280x720 d'abord, colonnes empilées sous 1100 px.
- Biseau diagonal : coin haut-gauche et bas-droit coupés (`border-radius: var(--r-4) var(--r-1)` + `corner-shape: bevel`, arrondi si non pris en charge). Hexagone pour avatars, maillons, fenêtres d'hologramme, dos de carte.
- Ombres `--ombre-1` à `-3` ; lueurs `--lueur-holo`, `--lueur-or`, `--lueur-danger` ; trame de balayage `--trame-holo` sur les panneaux projetés. Focus : contour cyan 2 px décalé de 3 px, jamais retiré.

## Cartes

- Cadre maison : couleur du type sur tout le pourtour, illustration carrée, gemme ronde d'attribut (ou de Magie/Piège) en haut à gauche, pastille de niveau en haut à droite, bloc nom/type/ATK-DEF en bas. Sous 100 px de large, seules l'illustration et les stats restent.
- Raretés : **Commune** rien ; **Rare** nom argent ; **Super** reflet holographique sur l'illustration ; **Ultra** reflet + liseré et nom or ; **Ultimate** illustration gravée en relief + or ; **Secret** prisme sur toute la carte, nom arc-en-ciel. Le reflet suit `--reflet-x/-y` (lié au pointeur par l'agent motion).
- États : ciblable (pulsation cyan), choisie (or), activée (lueur du camp + maillon numéroté), posée (voile hachuré, lisible par son seul propriétaire), non jouable (grisée), défense (90°, réduite à 80 % sur le terrain), face cachée (dos hexagonal).

## Duel (pour l'agent 3D)

- Plateau 7 colonnes par camp : Terrain, 5 Monstres, Cimetière (bannies en compteur) ; Extra Deck, 5 Magie/Piège, Deck. L'adversaire en miroir, ses cartes restent à l'endroit pour être lues.
- Caméra plongeante d'environ 45°, horizon de la ville derrière l'adversaire. Zones soulignées à la couleur du camp.
- Hologramme : seul le monstre qui agit (invocation, attaque, effet) se projette au-dessus de sa carte, dans un hexagone tramé ; les autres restent à plat.
- HUD réservé (`--hud-*`) : en haut plaque adverse, main adverse (dos), tour et phases ; à gauche détail de carte et votre plaque ; à droite chaîne, journal, question du moteur (cadre or, toujours visible) ; en bas votre main en éventail.

## Mouvement (pour l'agent motion)

Durées `--duree-1` à `-4`, courbes `--courbe-sortie` et `--courbe-ressort`. Moments forts : révélation des boosters graduée par rareté (légende sur l'écran Ouverture), hologramme qui se lève, faisceau d'attaque, LP qui défilent, bandeau Victoire/Défaite. `prefers-reduced-motion` : durées à 0, pas de boucle, seul un fondu de 150 ms reste (`--duree-fondu`, détail dans `motion.md`).

## Ton

Vouvoiement, phrases courtes, verbes d'action sur les boutons (« Lancer le duel », « Ne pas enchaîner »). Termes officiels français (Invocation, Position de Défense, Cimetière) et phases en anglais comme dans le jeu (Battle Phase). Les erreurs disent quoi faire. Espace insécable avant « ? ! : ». Récits du mode Histoire écrits par nous.

## Décisions validées (2026-09-29)

1. Hologramme : seul le monstre qui agit se projette, puis redescend ; un peu plus petit en 3D pour ne pas masquer la rangée adverse.
2. Lisibilité avant fidélité à la table : cartes adverses à l'endroit, vos cartes posées visibles sous un voile hachuré.
3. Titres en capitales Tektur partout.
4. Bannies : un compteur à côté du Cimetière, liste au clic (pas de 8e zone).
5. Caméra du duel à 52°.
6. 3D avec react-three-fiber, chargée seulement à l'entrée d'un duel.
7. Animations 2D en CSS et Web Animations API, sans bibliothèque.
8. Booster : une carte par toucher, de la moins rare à la plus rare, bouton « Tout révéler ».
9. Invocation d'un Dieu : bandes cinéma sur les LP environ 4,5 s, un clic passe.
10. Réduction des animations : fondu de 150 ms partout, 3D comprise.
11. Espace passe une séquence (avec clic et Échap) ; vitesse x2 quand plus de 3 messages du moteur attendent.
