# Container image for rackline-api (Cloud Run service). Built from the REPO ROOT
# (see cloudbuild.yaml) so the shared engine in lib/rackline/ is copied in and
# the service runs the exact code the website runs — one engine, two hosts.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app/services/rackline-api

# Install deps first for better layer caching.
COPY services/rackline-api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Shared, framework-free engine (pure TS, relative imports only).
COPY lib/rackline /app/lib/rackline
COPY services/rackline-api/src ./src

# Cloud Run sets $PORT (8080 by default).
CMD ["npx", "tsx", "src/server.ts"]
