FROM python:3.12-slim@sha256:ccc7089399c8bb65dd1fb3ed6d55efa538a3f5e7fca3f5988ac3b5b87e593bf0

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY workers/transcription-worker/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.24.0.43
RUN npm install -g @openai/codex@0.146.0

COPY workers/transcription-worker/src ./src

ENV PYTHONPATH=/app/src
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["python", "-m", "transcription_worker.main"]
