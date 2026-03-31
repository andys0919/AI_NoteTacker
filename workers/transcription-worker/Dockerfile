FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY workers/transcription-worker/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*
RUN npm install -g @openai/codex

COPY packages/meeting-ai-pipeline ./packages/meeting-ai-pipeline
COPY workers/transcription-worker/src ./src

ENV PYTHONPATH=/app/packages/meeting-ai-pipeline/src:/app/src
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["python", "-m", "transcription_worker.main"]
