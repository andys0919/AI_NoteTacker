import json
import mimetypes
import os
import subprocess
import tempfile
import uuid
import urllib.error
from urllib import request

MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_AZURE_MP3_BITRATE = "64k"
MAX_AUDIO_DURATION_MS = 1500 * 1000
DEFAULT_MAX_CHUNK_DURATION_MS = 20 * 60 * 1000


class AzureOpenAiTranscriber:
    def __init__(
        self,
        endpoint: str,
        deployment: str,
        api_key: str,
        api_version: str = "2025-03-01-preview",
        urlopen=None,
        duration_resolver=None,
        upload_plan_builder=None,
        remove_file=None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.deployment = deployment
        self.api_key = api_key
        self.api_version = api_version
        self.urlopen = urlopen or request.urlopen
        self.duration_resolver = duration_resolver or self._resolve_duration_ms
        self.upload_plan_builder = upload_plan_builder or self._build_upload_plan
        self.remove_file = remove_file or os.remove

    def transcribe(self, local_audio_path: str, on_progress=None) -> dict:
        upload_plan = self.upload_plan_builder(local_audio_path)
        total_ms = upload_plan[-1]["end_ms"] if upload_plan else 0
        collected_segments = []
        detected_language = "unknown"

        try:
            for part in upload_plan:
                payload = self._transcribe_upload(part["path"])

                if payload.get("language") and detected_language == "unknown":
                    detected_language = payload["language"]

                if payload.get("segments"):
                    part_segments = [
                        {
                            "start_ms": part["start_ms"] + int(float(segment.get("start", 0)) * 1000),
                            "end_ms": part["start_ms"] + int(float(segment.get("end", 0)) * 1000),
                            "text": segment.get("text", ""),
                        }
                        for segment in payload.get("segments", [])
                    ]
                else:
                    text = (payload.get("text") or "").strip()
                    part_segments = (
                        [
                            {
                                "start_ms": part["start_ms"],
                                "end_ms": part["end_ms"],
                                "text": text,
                            }
                        ]
                        if text
                        else []
                    )

                collected_segments.extend(part_segments)

                if on_progress is not None:
                    processed_ms = part["end_ms"]
                    percent = 100 if total_ms <= 0 else min(100, max(1, int((processed_ms / total_ms) * 100)))
                    on_progress(
                        {
                            "processed_ms": processed_ms,
                            "total_ms": total_ms,
                            "percent": percent,
                        }
                    )
        finally:
            for part in upload_plan:
                if part.get("cleanup"):
                    try:
                        self.remove_file(part["path"])
                    except OSError:
                        pass

        return {
            "language": detected_language,
            "segments": collected_segments,
            "usage": {
                "audio_ms": total_ms,
            },
        }

    def _transcribe_upload(self, upload_path: str) -> dict:
        boundary = f"----AINoteTacker{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(upload_path)[0] or "application/octet-stream"
        file_name = os.path.basename(upload_path)

        with open(upload_path, "rb") as handle:
            audio_bytes = handle.read()

        body = b"".join(
            [
                self._encode_field(boundary, "model", self.deployment),
                self._encode_field(boundary, "response_format", "json"),
                self._encode_file(boundary, "file", file_name, content_type, audio_bytes),
                f"--{boundary}--\r\n".encode("utf-8"),
            ]
        )

        http_request = request.Request(
            f"{self.endpoint}/openai/deployments/{self.deployment}/audio/transcriptions?api-version={self.api_version}",
            method="POST",
            headers={
                "api-key": self.api_key,
                "content-type": f"multipart/form-data; boundary={boundary}",
            },
            data=body,
        )

        try:
            with self.urlopen(http_request) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace").strip()
            message = f"Azure OpenAI transcription failed with status {error.code}"
            if details:
                message = f"{message}: {details}"
            raise RuntimeError(message) from error

    def _build_upload_plan(self, local_audio_path: str) -> list[dict]:
        total_duration_ms = self.duration_resolver(local_audio_path)

        if (
            os.path.getsize(local_audio_path) <= MAX_AUDIO_UPLOAD_BYTES
            and total_duration_ms <= MAX_AUDIO_DURATION_MS
        ):
            return [
                {
                    "path": local_audio_path,
                    "start_ms": 0,
                    "end_ms": total_duration_ms,
                    "cleanup": False,
                }
            ]

        compressed_path = self._new_temp_audio_path(".mp3")
        self._transcode_for_upload(local_audio_path, compressed_path)

        if (
            os.path.getsize(compressed_path) <= MAX_AUDIO_UPLOAD_BYTES
            and total_duration_ms <= MAX_AUDIO_DURATION_MS
        ):
            return [
                {
                    "path": compressed_path,
                    "start_ms": 0,
                    "end_ms": total_duration_ms,
                    "cleanup": True,
                }
            ]

        self.remove_file(compressed_path)

        upload_plan = []
        for start_ms in range(0, total_duration_ms, DEFAULT_MAX_CHUNK_DURATION_MS):
            duration_ms = min(DEFAULT_MAX_CHUNK_DURATION_MS, total_duration_ms - start_ms)
            chunk_path = self._new_temp_audio_path(".mp3")
            self._transcode_for_upload(
                local_audio_path,
                chunk_path,
                start_ms=start_ms,
                duration_ms=duration_ms,
            )
            upload_plan.append(
                {
                    "path": chunk_path,
                    "start_ms": start_ms,
                    "end_ms": start_ms + duration_ms,
                    "cleanup": True,
                }
            )

        return upload_plan

    def _encode_field(self, boundary: str, name: str, value: str) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n"
        ).encode("utf-8")

    def _encode_file(
        self,
        boundary: str,
        name: str,
        file_name: str,
        content_type: str,
        body: bytes,
    ) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{file_name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + body + b"\r\n"

    def _resolve_duration_ms(self, local_audio_path: str) -> int:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                local_audio_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        if probe.returncode != 0:
            return 0

        try:
            return max(0, int(float(probe.stdout.strip() or "0") * 1000))
        except ValueError:
            return 0

    def _new_temp_audio_path(self, suffix: str) -> str:
        descriptor, path = tempfile.mkstemp(prefix="azure-transcription-", suffix=suffix)
        os.close(descriptor)
        return path

    def _transcode_for_upload(
        self,
        source_path: str,
        output_path: str,
        start_ms: int | None = None,
        duration_ms: int | None = None,
    ) -> None:
        command = ["ffmpeg", "-v", "error"]

        if start_ms is not None:
          command.extend(["-ss", f"{start_ms / 1000:.3f}"])

        command.extend(["-i", source_path, "-vn"])

        if duration_ms is not None:
          command.extend(["-t", f"{duration_ms / 1000:.3f}"])

        command.extend(
            [
                "-ar",
                "16000",
                "-ac",
                "1",
                "-b:a",
                DEFAULT_AZURE_MP3_BITRATE,
                "-f",
                "mp3",
                output_path,
                "-y",
            ]
        )

        result = subprocess.run(command, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to prepare Azure transcription audio: {result.stderr.strip() or result.stdout.strip()}"
            )
