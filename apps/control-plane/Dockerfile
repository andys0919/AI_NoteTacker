FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json

RUN npm install

COPY apps/control-plane ./apps/control-plane

RUN npm run build --workspace @ai-notetacker/control-plane

EXPOSE 3000

CMD ["node", "apps/control-plane/dist/server.js"]
