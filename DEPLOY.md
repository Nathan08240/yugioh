# Déploiement Coolify

Un seul conteneur (`Dockerfile` à la racine) : le serveur de jeu sert le client construit, `/api` et le WebSocket `/ws` sur le même port. Réglages à faire à la main dans Coolify :

- **Application** : dépôt `Nathan08240/yugioh`, branche `main`, build pack **Dockerfile** (`/Dockerfile`).
- **Domaine** : `https://yugioh.nbrcs.pro`. **Port exposé** : `3001`.
- **WebSocket** : rien à régler, le proxy Caddy les relaie ; le client se connecte à `wss://yugioh.nbrcs.pro/ws`.
- **Stockage persistant** : un volume monté sur `/app/server/vendor/art`. Les illustrations manquantes s'y téléchargent en arrière-plan au démarrage (jamais dans git ni dans Supabase Storage).
- **Variables d'exécution** : `YUGIOH_DATABASE_URL=postgres://yugioh_server:<mdp>@supabase-db-qev63p3vw290a5k9tcubqatq:5432/postgres`, `SUPABASE_URL=https://supabase.nbrcs.pro`, `SUPABASE_ANON_KEY`. `PORT` vaut 3001 par défaut.
- **Variables de build** (case « Build Variable » cochée) : `VITE_SUPABASE_URL=https://supabase.nbrcs.pro`, `VITE_SUPABASE_ANON_KEY`.
- **Réseau** : option « Connect To Predefined Network » vers le réseau du service Supabase (`qev63p3vw290a5k9tcubqatq`), pour joindre `supabase-db-…` par son nom.
- **Supabase Auth** : ajouter `https://yugioh.nbrcs.pro` aux URL de redirection autorisées (lien de confirmation d'email).

Test local : `docker build -t yugioh --build-arg VITE_SUPABASE_URL=… --build-arg VITE_SUPABASE_ANON_KEY=… .` puis `docker run -p 3001:3001 -v yugioh-art:/app/server/vendor/art -e YUGIOH_DATABASE_URL=… -e SUPABASE_URL=… -e SUPABASE_ANON_KEY=… yugioh`.
