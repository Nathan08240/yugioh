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
- Comptes et sauvegarde : Supabase, schéma dédié `yugioh` (migration `yugioh_init` appliquée à la main le 2026-09-28).
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

- [ ] F-bot : joueur côté serveur qui répond aux questions du moteur
- [ ] F-starter-deck : choix du starter deck Yugi ou Kaiba après le pseudo, ajouté à la collection et enregistré comme premier deck
- [ ] F-collection-deck-builder : collection et decks limités aux cartes possédées
- [ ] F-ouverture-boosters : animation d'ouverture côté client
- [ ] F-histoire-systeme : chapitres, progression, règles spéciales, récompenses

## Vague 5

- [ ] F-histoire-arcs : un ticket par arc (Duelist Kingdom, Battle City, Noah, finales Battle City, Doma, Grand Championship KC, Monde des souvenirs), découpage à caler sur les 6 saisons
- [ ] F-deploiement-coolify : conteneur serveur + client sur Coolify
