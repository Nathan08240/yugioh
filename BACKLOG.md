# Backlog

## Décisions

- Moteur : ocgcore (EDOPro), règles officielles. Cartes limitées au Yu-Gi-Oh! classique (Duel Monsters), versions anime comprises (Dieux Égyptiens).
- 4000 LP.
- Règles : mode Goat du moteur (format d'avril 2005, rulings d'avant 2008), le plus proche de 2002.
- En ligne dès la v1 : un serveur Node fait tourner les duels, les clients passent par WebSocket. Le bot joue côté serveur.
- Boosters façon TCG Pocket : vrais sets de l'époque avec leurs raretés, 1 booster gratuit par timer et des boosters gagnés en jouant. Tirage côté serveur.
- Deck builder limité à la collection du joueur.
- Cadeau de départ : un starter deck au choix (Yugi SDY ou Kaiba SDK) à la création du profil.
- Chances des boosters : données YGOJSON telles quelles (Ultra 1:24 à partir de SOD confirmé par Yugipedia, Ultimate 1:12 non confirmé).
- Mode Histoire : les duels clés de chaque arc (~40 duels). Cartes anime débloquées par l'histoire (à valider).
- Comptes et sauvegarde : Supabase, schéma dédié `yugioh` (migration `yugioh_init` appliquée à la main le 2026-09-28, `yugioh_active_deck` appliquée par le MCP).
- Pool classique : 14 boosters LOB à FET et les starter decks Yugi, Kaiba, Joey, Pegasus (`server/data/sets.json`).
- Déploiement : Coolify.

## Vague 1

- [x] F-init-repo : création du repo
- [x] F-spike-moteur-ocgcore : preuve technique, un duel ocgcore dans Node à 4000 LP avec des cartes classiques et un Dieu Égyptien (feat/F-spike-moteur-ocgcore)

## Vague 2

- [x] F-pool-cartes-import : liste des cartes autorisées, import des données et des images (feat/F-pool-cartes-import)
- [x] F-serveur-partie : salles WebSocket, un duel par salle, informations cachées filtrées par joueur, reconnexion (feat/F-serveur-partie)
- [x] F-comptes-supabase : comptes et schéma `yugioh` (collection, decks, progression, timers de boosters) (feat/F-comptes-supabase)

## Vague 3

- [x] F-serveur-robustesse : une erreur du moteur (duelProcess) ne doit pas arrêter tout le serveur, seulement la salle concernée ; vérifier l'envoi des HINT publics aux deux joueurs (fix/F-serveur-robustesse)
- [x] F-client-lobby : scaffold Vite + React, créer ou rejoindre une salle par code (feat/F-client-lobby)
- [x] F-client-plateau : plateau et choix du joueur à partir des messages du moteur (feat/F-client-plateau)
- [x] F-boosters-serveur : sets, raretés, tirage, booster gratuit par timer (feat/F-boosters-serveur)

## Vague 4

- [x] F-bot : joueur côté serveur qui répond aux questions du moteur (feat/F-bot)
- [x] F-starter-deck : choix du starter deck Yugi ou Kaiba après le pseudo, ajouté à la collection et enregistré comme deck actif ; les duels utilisent le deck actif de chaque joueur (feat/F-starter-deck)
- [x] F-collection-deck-builder : collection et decks limités aux cartes possédées, deck actif au choix ; validation serveur (40-60, extra 15 fusions, 3 exemplaires, possédées, pool) (feat/F-collection-deck-builder)
- [x] F-ouverture-boosters : animation d'ouverture côté client, 1 booster au vainqueur d'un duel en ligne (feat/F-ouverture-boosters)
- [x] F-histoire-systeme : chapitres, progression, règles spéciales, récompenses, chapitre d'exemple Royaume des Duellistes (feat/F-histoire-systeme)

## Vague 5

- [x] F-cartes-fr : textes des cartes et messages du moteur en français, cartes dessinées avec leur illustration (feat/F-cartes-fr)
- [x] F-extra-deck-duel : Extra Deck du deck actif chargé dans les duels, fusions jouables (feat/F-extra-deck-duel)
- [x] F-histoire-duelist-kingdom : arc 1 complet (7 duels), bot aux règles de l'île, nom de la carte de règle (feat/F-histoire-duelist-kingdom)
- [x] F-histoire-battle-city : arc 2 (5 duels, règles Battle City, Slifer) (feat/F-histoire-battle-city)
- [x] F-histoire-noah : arc 3 (6 duels, règles Virtual World et Deck Masters) (feat/F-histoire-noah)
- [x] F-histoire-finales-battle-city : arc 4 (6 duels, Obelisk et Râ) (feat/F-histoire-finales-battle-city)
- [x] F-histoire-doma : arc 5 (5 duels, Sceau d'Orichalque) (feat/F-histoire-doma)
- [x] F-histoire-grand-championship : arc 6 (5 duels) (feat/F-histoire-grand-championship)
- [x] F-histoire-monde-des-souvenirs : arc 7 (5 duels) (feat/F-histoire-monde-des-souvenirs)
- [x] F-deploiement-coolify : image Docker unique, client servi par le serveur de jeu, volume des illustrations, lien vers le code, réglages dans DEPLOY.md (feat/F-deploiement-coolify)

## Interface Duel Disk

- [x] F-design-maquette : charte, maquette des 13 écrans, démo du mouvement, prototype 3D, 11 décisions validées (feat/F-design-maquette)
- [x] F-ui-fondations : charte dans le client, composant de carte, habillage, écrans de base (feat/F-ui-fondations)
- [x] F-ui-plateau-3d : plateau de duel en 3D (react-three-fiber), HUD, repli 2D (feat/F-ui-plateau-3d)
- [x] F-ui-collection-deck : collection et deck builder (feat/F-ui-collection-deck)
- [x] F-ui-boosters : écran et ouverture des boosters (feat/F-ui-boosters)
- [x] F-ui-histoire : écrans du mode Histoire (feat/F-ui-histoire)
- [x] Rareté des exemplaires dans la collection (feat/F-rarete-exemplaires)
- [x] Nom de l'adversaire en fin de duel, noms français des Dieux anime (feat/F-nom-adversaire, fix/F-dieux-anime-noms-fr)

## Retours de jeu

- [x] F-stats-monstres-a-jour : ATK et DEF actuelles sur le plateau (feat/F-stats-monstres-a-jour)
- [x] F-stats-fiche-detail : ATK et DEF actuelles dans la fiche de détail (feat/F-stats-fiche-detail)
- [x] F-coup-final-mauvaise-carte : coup final attribué à la carte qui inflige les dégâts (fix/F-coup-final-mauvaise-carte)
- [x] F-terrain-change-plateau : le plateau prend l'illustration de la Magie de Terrain (feat/F-terrain-change-plateau, fix/F-terrain-plus-visible)
- [x] F-glisser-deposer-cartes : glisser-déposer et actions sur les cartes (feat/F-glisser-deposer-cartes)
- [x] F-regles-speciales-visibles : règles spéciales et cause de la défaite expliquées (feat/F-regles-speciales-visibles)
- [x] F-nom-adversaire-journal : nom de l'adversaire dans le journal, la chaîne et les textes de fin (feat/F-nom-adversaire-journal)
- [x] F-echap-fermetures : Échap ferme seulement la fenêtre du dessus, badge des règles compris (fix/F-echap-fermetures)
- [x] F-bot-stats-reelles : le bot décide avec les ATK et DEF actuelles du terrain (feat/F-bot-stats-reelles)
- [x] F-alerte-fin-tour-royaume : confirmation avant End Phase sans monstre sous la règle du Royaume (feat/F-alerte-fin-tour-royaume)
- [x] F-apercu-combat : estimation du combat au glisser et au choix de la cible (feat/F-apercu-combat)
- [ ] Nom français du Noyau de Diabound (511000118)

## Grand lot du 2026-09-30

Migrations appliquées en production avant chaque fusion (schéma `yugioh`, ajouts seulement).

- [x] Paramètres, vitesse des animations, sons synthétisés, réglage des chaînes (feat/F-parametres, feat/F-sons-et-chaines)
- [x] Deck builder : import/export .ydk, main de test, recherche dans le texte, decks suggérés, construction automatique (feat/F-outils-deck, feat/F-decks-suggeres, feat/F-constructeur-auto)
- [x] Collection : classeur par booster, rareté et reflets, liste de souhaits, points de collection (feat/F-completion-sets, feat/F-rarete-exemplaires, feat/F-liste-souhaits, feat/F-economie)
- [x] Boosters : garantie Ultra, récompense du jour, pioche miracle ; commande admin (feat/F-economie, feat/F-pioche-miracle, feat/F-admin-boosters)
- [x] Duel : abandon, temps par décision, victoire sur déconnexion, revanche, émotes, signalement avec rejeu, écrans de toutes les questions du moteur (feat/F-fin-duel-serveur, feat/F-revanche, feat/F-emotes, feat/F-signaler-bug, feat/F-ecrans-questions, fix/F-declarer-carte)
- [x] Plateau 3D : nouveaux effets, rendu à la demande (feat/F-effets-3d, perf/F-3d-economie)
- [x] Bot : niveaux Débutant / Normal / Expert (feat/F-bot-niveaux)
- [x] Histoire : mode facile, étoiles et rejeu plafonné (feat/F-difficulte-histoire, feat/F-etoiles-histoire)
- [x] Modes : Scellé, Tour, Puzzles, événement de la semaine, tutoriel, classé Elo (feat/F-mode-scelle, feat/F-mode-tour, feat/F-puzzles, feat/F-evenements, feat/F-tutoriel, feat/F-mode-classe)
- [x] Social : profil, amis et défis, spectateur, regarder un ami, lien d'invitation (feat/F-profil, feat/F-amis, feat/F-spectateur, feat/F-amis-regarder, feat/F-lien-invitation)
- [x] Aide : page des règles et mots-clés (feat/F-aide-regles)
- [x] Téléphones et petits écrans (feat/F-mobile, fix du bloc du tour)
- [x] Outillage : tests navigateur Playwright, test de charge du serveur (chore/F-tests-navigateur, chore/F-test-charge)
- [x] Saisons mensuelles du mode classé (feat/F-saisons-classe)
- [x] Liste des cartes limitées du format Goat, en classé et en événement seulement, avec « Rendre conforme » (feat/F-liste-limitee)
- [x] Draft carte par carte contre 3 bots (feat/F-mode-draft)
- [ ] Musique

## Second lot (vague 1)

Migrations appliquées en production le 2026-10-05 avant la fusion (missions, échanges, revoir ses duels, revanche).

- [x] Bot Expert plus fort : coup fatal, magies posées, choix du piège (feat/F-bot-expert)
- [x] Missions du jour et succès (feat/F-missions-succes)
- [x] Échange de cartes entre amis (feat/F-echange-cartes)
- [x] Salles privées avec règles personnalisées (feat/F-salles-perso)
- [x] Revoir ses 20 derniers duels (feat/F-historique-duels)
- [x] Mise en ligne sans couper les duels en cours (feat/F-arret-propre) ; réglage Coolify à faire : Stop grace period à 960 s
- [x] Histoire : Rex Raptor, Bonz, Panik et Ishizu (feat/F-histoire-adversaires), parcours bonus de Kaiba (feat/F-parcours-kaiba), revanche des boss (feat/F-revanche-boss)
- [x] Simulation de l'économie, sans changement de taux (chore/F-simulation-economie)
- [x] Animations de duel façon Master Duel (feat/F-animations-combat)
- [x] Lancers de dé et de pièce visibles (fix/F-des-pieces)
- [x] Déclarer un nom de carte depuis son deck (fix/F-declarer-deck)
- [x] Vague 2 : banc bot contre bot de l'histoire et decks adverses rééquilibrés (feat/F-banc-bots), performances client (perf/F-perf-client, plateau 3D sans react-three-fiber) et serveur (perf/F-perf-serveur, index appliqué le 2026-10-07)
- [x] Écran d'accueil repensé : hiérarchie, grille des modes, missions lisibles (feat/F-accueil-refonte)
- [ ] Vague 3 : découpage de server.ts, tests e2e

## Mise en ligne

- [x] Passer le repo GitHub en public (licence AGPL du moteur)
- [x] Créer l'application Coolify selon DEPLOY.md (yugioh.nbrcs.pro, volume, variables, réseau Supabase)
- [ ] Ajouter https://yugioh.nbrcs.pro aux URL de redirection de Supabase Auth
