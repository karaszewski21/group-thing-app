# syntax=docker/dockerfile:1
#
# Build context is the repo root (not src/frontend/), because the frontend's
# test suite imports the sibling `plugins/server-sdk.ts` module by relative
# path — see docker-compose.yml's `frontend.build.context`.

FROM node:22-alpine AS builder

WORKDIR /app

COPY src/frontend/package.json src/frontend/package-lock.json ./src/frontend/
RUN cd src/frontend && npm ci

COPY src/frontend ./src/frontend
COPY plugins/server-sdk.ts ./plugins/server-sdk.ts
RUN cd src/frontend && npm run build

FROM nginx:1.27-alpine AS runtime

COPY src/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/src/frontend/dist /usr/share/nginx/html

EXPOSE 80
