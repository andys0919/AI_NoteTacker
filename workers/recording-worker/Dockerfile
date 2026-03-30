FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY workers/recording-worker/package.json workers/recording-worker/package.json

RUN npm install

COPY workers/recording-worker ./workers/recording-worker

RUN npm run build --workspace @ai-notetacker/recording-worker

CMD ["node", "workers/recording-worker/dist/main.js"]
