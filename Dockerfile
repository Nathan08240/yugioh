# Image unique : le serveur de jeu sert aussi le client construit. Voir DEPLOY.md.
FROM node:24 AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY client/package.json client/

# Données du moteur : scripts, base de cartes, chaînes EDOPro, textes français. YGOJSON ne sert qu'à cards-fr.json.
FROM base AS vendor
COPY server/scripts/vendor.ts server/scripts/
RUN pnpm vendor && rm -rf server/vendor/YGOJSON server/vendor/*/.git

FROM base AS client
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server/src server/src
COPY server/data/suggested-decks.json server/data/
COPY client client
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN pnpm --filter client build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim
ENV NODE_ENV=production PORT=3001
# Le healthcheck de Coolify appelle curl, absent de l'image slim.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app ./
COPY server/src server/src
COPY server/data server/data
COPY server/scripts/images.ts server/scripts/
# Le bot rejoue le plateau du client.
COPY client/src/board.ts client/src/
COPY --from=client /app/client/dist client/dist
COPY --from=vendor /app/server/vendor server/vendor
# Illustrations sur un volume persistant, téléchargées au démarrage si elles manquent.
RUN mkdir server/vendor/art && chown node:node server/vendor/art
USER node
WORKDIR /app/server
EXPOSE 3001
CMD ["node", "src/server.ts"]
