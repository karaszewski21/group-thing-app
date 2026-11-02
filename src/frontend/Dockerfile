# syntax=docker/dockerfile:1
#
# Build context is the repo root (not src/frontend/), because the frontend's
# test suite imports the sibling `plugins/server-sdk.ts` module by relative
# path, and `next build` type-checks it — see docker-compose.yml's
# `web.build.context`.

FROM node:22-alpine AS deps

WORKDIR /app/src/frontend

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/src/frontend/node_modules ./src/frontend/node_modules
COPY src/frontend ./src/frontend
COPY plugins/server-sdk.ts ./plugins/server-sdk.ts
# Referrer-restricted browser key, inlined into the client bundle at build
# time; empty = manual mode.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
# next.config rewrites are fixed at build time (fallback when nginx is not in
# front); proxy.ts and server fetches read the runtime value from compose.
ARG BACKEND_INTERNAL_URL=http://backend:8080
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
# `prebuild` builds the plugin SDK into public/assets first.
RUN cd src/frontend && npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Warsaw

COPY --from=build --chown=node:node /app/src/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/src/frontend/.next/static ./.next/static
COPY --from=build --chown=node:node /app/src/frontend/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
