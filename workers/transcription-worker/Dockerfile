FROM python:3.12-slim

WORKDIR /app

COPY workers/transcription-worker/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt

COPY workers/transcription-worker/src ./src

ENV PYTHONPATH=/app/src

CMD ["python", "-m", "transcription_worker.main"]
