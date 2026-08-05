FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY workers/recording-worker/package.json workers/recording-worker/package.json

RUN npm ci

COPY workers/recording-worker ./workers/recording-worker

RUN npm run build --workspace @ai-notetacker/recording-worker

FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/workers/recording-worker/package.json ./workers/recording-worker/package.json
COPY --from=build /app/workers/recording-worker/dist ./workers/recording-worker/dist

CMD ["node", "workers/recording-worker/dist/main.js"]
