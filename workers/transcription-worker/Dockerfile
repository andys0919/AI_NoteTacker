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

# Whole-recording speaker diarization (pyannote community-1, CC-BY-4.0). torch comes
# from the cu128 index so the RTX 50 series (sm_120) works; the ~30 MB weights are
# fetched on first use into the same persistent Hugging Face cache as the Whisper model.
# torch pins its own CUDA runtime exactly, so this step downgrades the cuBLAS/cuDNN
# wheels above to 12.8.4.1 / 9.19.0.56. Both still carry sm_120 kernels and ctranslate2
# loads against them; re-pinning the newer pair here would break torch instead.
RUN pip install --no-cache-dir torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128   && pip install --no-cache-dir pyannote.audio==4.0.7 sherpa-onnx==1.13.7

# Voice-split embedding: CNCeleb-trained WeSpeaker ResNet34 (Apache-2.0, from the
# sherpa-onnx releases). Baked into the image so a job never depends on GitHub.
ADD https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_zh_cnceleb_resnet34_LM.onnx /models/speaker-embedding.onnx
RUN echo '87d1d5068397f3792c730570b53d66cd8be1da7ea22dd04f5b6706d96a3cd168  /models/speaker-embedding.onnx' | sha256sum -c -

RUN chmod a+r /models/speaker-embedding.onnx

COPY workers/transcription-worker/src ./src

# Diarization reports a CPU fallback on stdout; without this Python buffers it out of
# docker logs and a silent slowdown looks like a stall.
ENV PYTHONUNBUFFERED=1

ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["python", "-m", "transcription_worker.main"]
