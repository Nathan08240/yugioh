# Backlog

## Décisions

- Moteur : ocgcore (EDOPro), règles officielles. Cartes limitées au Yu-Gi-Oh! classique (Duel Monsters), versions anime comprises (Dieux Égyptiens).
- 4000 LP.
- En ligne dès la v1 : un serveur Node fait tourner les duels, les clients passent par WebSocket. Le bot joue côté serveur.
- Boosters façon TCG Pocket : vrais sets de l'époque avec leurs raretés, 1 booster gratuit par timer et des boosters gagnés en jouant. Tirage côté serveur.
- Deck builder limité à la collection du joueur.
- Mode Histoire : les duels clés de chaque arc (~40 duels). Cartes anime débloquées par l'histoire (à valider).
- Comptes et sauvegarde : Supabase, schéma dédié `yugioh`.
- Déploiement : Coolify.

## Vague 1

- [x] F-init-repo : création du repo
- [ ] F-spike-moteur-ocgcore : preuve technique, un duel ocgcore dans Node à 4000 LP avec des cartes classiques et un Dieu Égyptien

## Vague 2

- [ ] F-pool-cartes-import : liste des cartes autorisées, import des données et des images
- [ ] F-serveur-partie : salles WebSocket, un duel par salle, informations cachées filtrées par joueur, reconnexion
- [ ] F-comptes-supabase : comptes et schéma `yugioh` (collection, decks, progression, timers de boosters)

## Vague 3

- [ ] F-client-lobby : scaffold Vite + React, créer ou rejoindre une salle par code
- [ ] F-client-plateau : plateau et choix du joueur à partir des messages du moteur
- [ ] F-boosters-serveur : sets, raretés, tirage, booster gratuit par timer

## Vague 4

- [ ] F-bot : joueur côté serveur qui répond aux questions du moteur
- [ ] F-collection-deck-builder : collection et decks limités aux cartes possédées
- [ ] F-ouverture-boosters : animation d'ouverture côté client
- [ ] F-histoire-systeme : chapitres, progression, règles spéciales, récompenses

## Vague 5

- [ ] F-histoire-arcs : un ticket par arc (Duelist Kingdom, Battle City, Noah, finales Battle City, Doma, Grand Championship KC, Monde des souvenirs), découpage à caler sur les 6 saisons
- [ ] F-deploiement-coolify : conteneur serveur + client sur Coolify
