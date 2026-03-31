FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY workers/transcription-worker/requirements.txt ./requirements.txt

ARG MEETING_AI_PIPELINE_GIT_URL=https://github.com/andys0919/meeting-ai-pipeline.git
ARG MEETING_AI_PIPELINE_GIT_REF=main

RUN pip install --no-cache-dir -r requirements.txt nvidia-cublas-cu12 nvidia-cudnn-cu12==9.* \
  "git+${MEETING_AI_PIPELINE_GIT_URL}@${MEETING_AI_PIPELINE_GIT_REF}"
RUN npm install -g @openai/codex

COPY workers/transcription-worker/src ./src

ENV PYTHONPATH=/app/src
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["python", "-m", "transcription_worker.main"]
