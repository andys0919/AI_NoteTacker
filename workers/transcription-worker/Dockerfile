FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea AS codex-build

RUN npm install -g @openai/codex@0.146.0

FROM python:3.12-slim@sha256:ccc7089399c8bb65dd1fb3ed6d55efa538a3f5e7fca3f5988ac3b5b87e593bf0 AS worker-base

WORKDIR /app

ENV PYTHONPATH=/app/src

FROM worker-base AS summary

COPY --from=codex-build /usr/local/bin/node /usr/local/bin/node
COPY --from=codex-build /usr/local/lib/node_modules/@openai/codex /usr/local/lib/node_modules/@openai/codex

RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex

COPY workers/transcription-worker/src ./src

CMD ["python", "-m", "transcription_worker.summary_main"]

FROM worker-base AS transcription

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY workers/transcription-worker/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.24.0.43

COPY workers/transcription-worker/src ./src

ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["python", "-m", "transcription_worker.main"]
