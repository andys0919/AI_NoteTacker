FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json

RUN npm install

COPY apps/control-plane ./apps/control-plane

RUN npm run build --workspace @ai-notetacker/control-plane

EXPOSE 3000

CMD ["node", "apps/control-plane/dist/server.js"]
