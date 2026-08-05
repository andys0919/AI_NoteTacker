FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json

RUN npm ci

COPY apps/control-plane ./apps/control-plane

RUN npm run build --workspace @ai-notetacker/control-plane
RUN npm prune --omit=dev

FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/control-plane/package.json ./apps/control-plane/package.json
COPY --from=build /app/apps/control-plane/dist ./apps/control-plane/dist
COPY --from=build /app/apps/control-plane/public ./apps/control-plane/public

EXPOSE 3000

CMD ["node", "apps/control-plane/dist/server.js"]
