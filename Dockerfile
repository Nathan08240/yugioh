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
COPY client client
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN pnpm --filter client build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim
ENV NODE_ENV=production PORT=3001
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
# Image slim sans curl ni wget : Coolify reprend ce healthcheck à la place du sien.
HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 CMD node -e "fetch('http://localhost:' + process.env.PORT).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.ts"]
