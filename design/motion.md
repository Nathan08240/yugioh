# Mouvement « Duel Disk »

Voir : `pnpm --filter client exec vite ../design --port 5190`, puis `/motion/index.html` (un bouton par séquence, case « Réduire les animations » pour tester). Jetons : `tokens.css`.

## Principes

- **Durées** : `--duree-1` 120 ms (survol, appui, levée) · `-2` 220 ms (panneaux, pastilles, sorties) · `-3` 420 ms (vol, retournement, maillon, entrée d'écran) · `-4` 900 ms (LP, révélation, rayons). Un geste courant tient en 1,6 s, un moment fort en 4,5 s au plus.
- **Courbes** : `--courbe-sortie` pour ce qui arrive (décélère) · `--courbe-elan` pour ce qui part, tombe ou frappe (accélère jusqu'à l'impact) · `--courbe-ressort` pour ce qui surgit (pastille, maillon, libellé) · linéaire seulement pour les boucles et les secousses.
- **Hiérarchie** : 1. l'information (question du moteur, LP, phase) reste lisible et n'est jamais recouverte ; 2. une seule action bouge fort à la fois ; 3. l'ambiance (rayons, pulsations) est lente et de faible amplitude.
- **Passer** : clic, Espace ou Échap termine la séquence en cours. Si la file des messages du moteur prend du retard (plus de 3 en attente), tout passe à vitesse ×2.
- **Éclairs** : un seul par séquence, localisé, jamais plus de 3 par seconde (WCAG 2.3.1).
- **Réduction (`prefers-reduced-motion`)** : ni déplacement, ni échelle, ni rotation, ni secousse, ni éclair, ni particule, ni boucle. L'état final s'affiche d'un coup, les apparitions et disparitions gardent un fondu de 150 ms (`--duree-fondu`), les temps de lecture restent, les LP sautent à leur valeur finale.

## Bibliothèque : CSS + Web Animations API, aucune dépendance

1. Le spectaculaire (plateau, cartes posées, hologrammes, faisceaux) vit dans Three.js ; en 2D il reste des translations, opacités, échelles et compteurs, que `element.animate()` fait nativement, `finished` servant à enchaîner les étapes.
2. 0 ko ajouté. Motion 13.4.5 (dernière version npm, vérifiée le 29/09/2026) coûte 42,6 ko gzip (`motion` + `AnimatePresence` de `motion/react`), 29,3 ko en `LazyMotion`, 4,1 ko pour `useAnimate` de `motion/react-mini` (mesures faites avec le Vite 8 du projet).
3. Trois fonctions de la démo (`anim`, `pause`, `passer`, une soixantaine de lignes) portent la réduction et le « passer » ; elles deviennent un hook React tel quel.

À revoir si le deck builder demande des animations de disposition (cartes qui se réordonnent) : Motion avec `LazyMotion` à ce moment-là.

## 3D ou 2D

- **Three.js (react-three-fiber)** : plateau et caméra ; cartes sur le terrain (sortie du Deck, vol vers la zone, atterrissage, pose, retournement, changement de position) ; hologrammes ; faisceau et impact ; bris et envoi au Cimetière ; vortex de Fusion ; aura et hologramme du Dieu ; secousse de caméra.
- **2D (HUD)** : transitions d'écran ; main (levée, réorganisation, arrivée de la pioche) ; LP ; bandeaux de phase et de tour ; chaîne et journal ; question du moteur ; chiffres de dégâts (placés sur la projection de la zone) ; voile et bandes cinéma ; booster (cartes en CSS 3D) ; fin de duel ; survol holographique.
- **Relais main → plateau** : la carte 2D se lève (120 ms) puis disparaît ; la carte 3D naît à sa position projetée et vole vers sa zone. Mêmes durées et courbes des deux côtés.
- **File d'animations** : chaque message moteur (`DRAW`, `SUMMONING`, `SPSUMMONING`, `FLIPSUMMONING`, `SET`, `MOVE`, `POS_CHANGE`, `ATTACK`, `DAMAGE`, `PAY_LPCOST`, `CHAINING`, `CHAIN_SOLVED`, `CHAIN_NEGATED`, `NEW_PHASE`, `NEW_TURN`, `WIN`) lance une chorégraphie qui renvoie une promesse ; `board.ts` reste pur et à jour, l'affichage le rattrape. Une question du moteur attend la fin de l'action qu'elle concerne, pas les temps décoratifs (hologramme qui tient, bandeau), qui sont coupés.

## Chorégraphies

Temps en ms depuis le début (durée de l'étape entre parenthèses).

| Séquence | Étapes | En réduction |
| --- | --- | --- |
| Entrée d'écran | blocs en cascade, montée 18 px + opacité (420, sortie), décalage 60 par bloc | fondu d'ensemble |
| Transition d'écran | 0 sortie : opacité, échelle 0,98, flou 4 px (220, élan) · 220 balayage cyan de haut en bas (420) + entrée en cascade ; interactif dès l'entrée · ≈ 0,9 s | fondu, sans balayage |
| Pioche | 0 la carte quitte le Deck (220, 3D) · 220 vol vers la main (420) avec retournement à mi-course, la main se réorganise · 640 rebond (220, ressort) · ≈ 0,9 s | la carte apparaît en fondu |
| Invocation normale | 0 levée (120) · 120 vol (420) · 540 chute sur la zone (220, élan) + onde · 760 hologramme se lève (220) · tient 400 · baisse (220, élan) · ≈ 1,6 s | carte et hologramme en fondu, tenue gardée |
| Invocation Sacrifice | 0 le sacrifié se dissout en lumière vers la zone (420, élan) · puis invocation lourde : chute (420, élan), onde or, secousse (220) · tient 500 · ≈ 2,3 s | fondus |
| Invocation Fusion | 0 Polymérisation posée puis activée · 760 matériaux aspirés en spirale (900, élan) dans un vortex violet · 1660 éclair, le monstre de Fusion tombe (420) · hologramme, tient 500 · ≈ 3 s | fondus, sans vortex |
| Dieu Égyptien | 0 voile + bandes cinéma (420) · la carte brandie au centre (420) · 3 sacrifices dissous vers elle (décalés de 120) · aura, secousse · la carte s'abat (220, élan), éclair, forte secousse · hologramme géant (900) + nom (900) · tient 1000 · retrait (420) · ≈ 4,5 s ; seule séquence qui couvre le HUD | voile, hologramme et nom en fondu, tenue gardée |
| Pose face cachée | 0 levée (120) · vol (420) en se retournant (voile hachuré ; monstre : rotation de 90°) · pose douce (220), onde discrète · pas d'hologramme · ≈ 0,9 s | fondu |
| Retournement | 0 soulève (120) · s'écrase et change de face (210 élan + 210 sortie) · liseré du camp (900) · repose (220, élan) · effet Flip : + hologramme | changement de face immédiat |
| Attaque et impact | 0 hologramme de l'attaquant (220) · 220 faisceau (220, élan) · 440 impact : éclair local, onde danger, secousse de la cible (220), dégâts pop (220, ressort), tiennent 500, s'effacent (900) · ≈ 1,7 s avec destruction | faisceau affiché d'un coup, dégâts en fondu |
| Dégâts et LP | pastille −X (220, ressort) · lueur danger de la plaque (900) · chiffres qui défilent et barre qui se vide (900, ralentit à la fin) · sous 1000 LP : pulsation lente · attaque directe : bords rouges (120 + 900), plaque secouée | valeur finale d'un coup, pas de pulsation |
| Destruction | 0 la carte se brise en deux (420, élan) + éclats · 420 une copie translucide vole au Cimetière (420) · compteur +1 (420, ressort) · ≈ 0,9 s | la carte s'efface, compteur à jour |
| Magie/Piège et chaîne | 0 la carte se redresse (220, 3D) · voile retiré, lueur du camp, onde · maillon numéroté (420, ressort) · retombe (420) · la ligne entre en haut de la chaîne (420), les autres glissent · résolution du dernier au premier : ligne illuminée (420), maillon du plateau s'éteint (420, élan), ligne sortie à droite (220, élan) ; annulé = barré | lignes et maillons en fondu |
| Phase et tour | la phase active s'étire (420) · bandeau ouvert depuis le centre (220) + titre qui se resserre (420) · tient 700 · sort à gauche (220, élan) · ≈ 1,5 s · tour : même bandeau à la couleur du camp, sa plaque s'allume | bandeau en fondu, tenue gardée |
| Victoire | rayons d'or (1320, puis rotation lente) · 120 le titre se resserre (900) · 900 score (420) · 1120 récompenses en cascade de 150 (420, ressort) · 1800 boutons | tout en fondu, rayons fixes |
| Défaite | sans rayons, plus lent : 220 le titre tombe et se précise, flou 8 px → 0 (1320) · décrochage du signal (220, 3 pas) · 1320 coup final glisse de la gauche · 1800 boutons | tout en fondu |
| Ouverture de booster | 0 le paquet arrive (420) · balancement (420) · 840 déchirure (220, élan) + petit éclair · bande arrachée (420, élan) · 1480 le paquet descend, la pile monte (420) · ≈ 2,1 s · ensuite un toucher = une carte, un toucher pendant = passer | fondus |
| Révélation par rareté | **Commune** retournement sec (220) · **Rare** lueur argent (220), retournement (220), éclat argenté qui balaie (900) · **Super** lueur cyan (420), retournement (420), reflet holo (900), onde · **Ultra** lueur or + tremblement (420), suspense (220), éclair, rayons d'or, retournement (420), reflet (900) · **Ultimate** lueur + tremblement (900), rayons, retournement lent (900), bascule lente qui montre le relief (1320) · **Secret** voile (420), tremblement + prisme (900), suspense (220), anneau prismatique, 14 éclats, éclair, rayons prisme, retournement (420), reflet, voile levé · ≈ 3,6 s · puis libellé (420, ressort dès Ultra) et « Nouvelle carte » (220) ; au toucher suivant la carte rejoint sa place dans la rangée (420) | carte révélée d'un coup, libellé en fondu, rayons fixes |
| Survol holographique | le reflet suit le pointeur, inclinaison jusqu'à 9° (220) | reflet seul, sans inclinaison |
