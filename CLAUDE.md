# Yu-Gi-Oh! Duel Monsters (jeu web)

Duels en ligne et contre un bot, boosters façon TCG Pocket, mode Histoire. Backlog et décisions : `BACKLOG.md`.

## Stack

- `server/` : Node 24, TypeScript exécuté nativement (syntaxe effaçable seulement : pas d'`enum`, `namespace` ni propriétés de paramètre). Moteur ocgcore via `@n1xx1/ocgcore-wasm`.
- `client/` : Vite + React + TypeScript, types du protocole importés de `server/src/protocol.ts`.
- Supabase : schéma dédié `yugioh`, jamais `public`.

## Commandes

pnpm uniquement (workspace `pnpm-workspace.yaml`) : `pnpm install`, `pnpm test`, `pnpm typecheck` à la racine, `pnpm --filter server add <dep>` pour une dépendance. `pnpm test` ne demande pas Docker ; `pnpm test:db` lance à part les tests `*.pg.test.ts` sur un Postgres jetable Docker (après un changement de base ou avant une mise en ligne). `pnpm dev` lance client et serveur ; configuration : copier `client/.env.example` et `server/.env.example` en `.env`. Déploiement (Docker, Coolify) : `DEPLOY.md`.

## Conventions

- Commits `<type>: <description>` en français (`feat`, `fix`, `chore`, `refactor`). Branches `<type>/<ID>-<slug>`.
- Le serveur fait autorité : duels, tirage des boosters, récompenses. Le client n'affiche que ce que le serveur lui envoie.

## Contraintes

- Moteur ocgcore sous AGPL-3.0 : le code du jeu reste public.
- Noms et images de cartes : propriété de Konami, pas de monétisation. Textes du mode Histoire écrits par nous, pas de dialogues de l'anime.
