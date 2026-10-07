# Open Historia — the public multiplayer server's container image © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE).
#
# Built by ops/docker-compose.yml (build: ../server-mp). Only the runtime
# dependency (ws, pinned by package-lock.json) and src/ go in; the tests and
# the docs stay out (.dockerignore). The server runs as the image's
# unprivileged "node" user, and compose mounts its filesystem read-only: it
# writes nothing but its log, to stdout.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# Nothing here needs an install script, so none is allowed to run.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8787
CMD ["node", "src/server.js"]
