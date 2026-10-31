# One image, two containers on the sites server (see the hanbok repo's
# deploy/sites/docker-compose.yml):
#   scraple-api  node server/index.js   (:5677, spawns bot/index.js daily)
#   scraple      next start in app/     (:3000, proxies /api to scraple-api)
# The server also reads the Collins word list at the repo root and the font
# and logo in app/public, so the whole tree ships.
FROM node:22-bookworm-slim AS build
WORKDIR /srv/scraple
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --no-audit --no-fund
COPY . .
ARG API_INTERNAL_URL=http://scraple-api:5677
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN cd app && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv/scraple
COPY --from=build --chown=node:node /srv/scraple ./
USER node
EXPOSE 3000 5677
CMD ["node", "server/index.js"]
