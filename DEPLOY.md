# Déploiement Coolify

Un seul conteneur (`Dockerfile` à la racine) : le serveur de jeu sert le client construit, `/api` et le WebSocket `/ws` sur le même port. Réglages à faire à la main dans Coolify :

- **Application** : dépôt `Nathan08240/yugioh`, branche `main`, build pack **Dockerfile** (`/Dockerfile`), serveur `pulseheberg-applications` (93.127.158.53).
- **Domaine** : `https://yugioh.nbrcs.pro`. **Port exposé** : `3001`, sans mapping de port (tout passe par Caddy).
- **WebSocket** : rien à régler, le proxy Caddy les relaie ; le client se connecte à `wss://yugioh.nbrcs.pro/ws`.
- **Stockage persistant** : un volume monté sur `/app/server/vendor/art`. Les illustrations manquantes s'y téléchargent en arrière-plan au démarrage (jamais dans git ni dans Supabase Storage).
- **Variables d'exécution** (runtime seulement) : `YUGIOH_DATABASE_URL=postgres://yugioh_server:<mdp>@100.99.0.1:5432/postgres`, `SUPABASE_URL=https://supabase.nbrcs.pro`, `SUPABASE_ANON_KEY`. `PORT` vaut 3001 par défaut. `ADMIN_USER_IDS` (facultatif) : id Supabase des comptes, séparés par des virgules, qui voient le bouton « Admin : +10 boosters ».
- **Variables de build** (build seulement) : `VITE_SUPABASE_URL=https://supabase.nbrcs.pro`, `VITE_SUPABASE_ANON_KEY`.
- **Mise en ligne sans couper les duels** : à chaque déploiement, Coolify démarre le nouveau conteneur (mise à jour progressive grâce au healthcheck sur `/`), puis envoie SIGTERM à l'ancien. Celui-ci refuse les nouveaux duels, affiche un bandeau et s'arrête dès que les duels en cours sont finis, au plus tard après `SHUTDOWN_MINUTES` (15 par défaut, duels restants interrompus sans victoire ni défaite). Docker le tue au bout de 30 s par défaut : régler **Advanced > Operations > Stop grace period** à `960` secondes (Coolify 4.1 ou plus récent, maximum 3600).
- **Supabase Auth** : ajouter `https://yugioh.nbrcs.pro` aux URL de redirection autorisées (lien de confirmation d'email).

## Base de données : tunnel WireGuard

Supabase tourne sur le serveur Coolify `localhost` (93.127.158.88), le jeu sur `pulseheberg-applications` (93.127.158.53). Postgres n'est jamais publié sur une IP publique :

- **Tunnel** : `wg0` sur les deux serveurs (`/etc/wireguard/wg0.conf`, clé privée dans `wg0.key`, service `wg-quick@wg0` activé), `100.99.0.1` sur .88 et `100.99.0.2` sur .53, UDP 51820. Plage hors des réseaux Docker (.88 réserve `10.0.0.0/8`).
- **Relais sur .88** : conteneur `yugioh-db-relay` (`alpine/socat` figé par empreinte, `--restart unless-stopped`) sur le réseau `coolify`, publié seulement sur `100.99.0.1:5432`, vers `supabase-db-qev63p3vw290a5k9tcubqatq:5432`. Il exige l'option « Connect To Predefined Network » du service Supabase (supabase-db sur le réseau `coolify`).
- **Démarrage** : `/etc/systemd/system/docker.service.d/wg0.conf` fait démarrer Docker après `wg0`, sinon le relais ne peut pas se lier à `100.99.0.1`.
- **Vérifier** : sur .53, `ping 100.99.0.1` et `timeout 5 bash -c "</dev/tcp/100.99.0.1/5432"` ; sur .88, `wg show` et `docker ps --filter name=yugioh-db-relay`.
- **Supabase** : le modèle Coolify utilise `quay.io/minio/mc`, retiré par MinIO ; `minio-createbucket` prend `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z`, qui contient `/usr/bin/mc`.

Test local : `docker build -t yugioh --build-arg VITE_SUPABASE_URL=… --build-arg VITE_SUPABASE_ANON_KEY=… .` puis `docker run -p 3001:3001 -v yugioh-art:/app/server/vendor/art -e YUGIOH_DATABASE_URL=… -e SUPABASE_URL=… -e SUPABASE_ANON_KEY=… yugioh`.

Test de charge : `pnpm --filter server load [--ws] [--delay ms] [paliers]` (hors `pnpm test`). Sur un poste de dev (8 coeurs, non chargé à vide), 100 duels bot contre bot simultanés : environ 400 Mo de rss (100 Mo au départ, 3 Mo par duel, presque tout dans le moteur WebAssembly, qui garde sa mémoire pour les duels suivants), 0,15 à 0,3 ms par décision, 10 s de CPU pour les 100 duels, 66 Ko de messages WebSocket par duel et par joueur, 0 erreur ; au rythme réel du bot (700 ms) le CPU reste sous 3 % d'un coeur. Le facteur limitant est la mémoire, pas le CPU. Compression permessage-deflate laissée désactivée : mesurée à 0,1 à 0,3 Mo de plus par connexion et 10 à 20 fois plus de CPU par gros message, pour une bande passante qui n'est pas le goulot.
