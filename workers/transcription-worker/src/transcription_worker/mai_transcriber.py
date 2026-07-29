import json
import mimetypes
import os
import time
import uuid
import urllib.error
from urllib import request

from transcription_worker.azure_openai_transcriber import AzureOpenAiTranscriber


MAI_CHUNK_DURATION_MS = 30_000
MAI_MAX_WORKERS = 3
MAI_HTTP_400_RETRY_DELAY_SECONDS = 2.0
MAI_TRANSPORT_RETRY_DELAYS_SECONDS = (2.0, 10.0, 30.0)


class MaiTranscriber(AzureOpenAiTranscriber):
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str = "mai-transcribe-1.5",
        api_version: str = "2025-10-15",
        timeout_seconds: int = 300,
        retry_sleep=None,
        **kwargs,
    ) -> None:
        super().__init__(
            endpoint=endpoint,
            deployment=model,
            api_key=api_key,
            api_version=api_version,
            timeout_seconds=timeout_seconds,
            max_chunk_duration_ms=MAI_CHUNK_DURATION_MS,
            independent_chunk_max_workers=MAI_MAX_WORKERS,
            provider_label="Azure Speech MAI-Transcribe 1.5",
            retry_sleep=retry_sleep,
            **kwargs,
        )
        self.retry_sleep = retry_sleep or time.sleep

    def _build_request_prompt(self, workflow_context) -> str:
        return ""

    def _transcription_url(self) -> str:
        return (
            f"{self.endpoint}/speechtotext/transcriptions:transcribe"
            f"?api-version={self.api_version}"
        )

    def _transcription_headers(self, boundary: str) -> dict[str, str]:
        return {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "content-type": f"multipart/form-data; boundary={boundary}",
        }

    def _transcribe_upload(self, upload_path: str, request_prompt: str = "") -> dict:
        boundary = f"----AINoteTacker{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(upload_path)[0] or "application/octet-stream"
        file_name = os.path.basename(upload_path)
        definition = json.dumps(
            {
                "enhancedMode": {
                    "enabled": True,
                    "model": self.deployment,
                    "transcribeStyle": "verbatim",
                }
            },
            separators=(",", ":"),
        )

        with open(upload_path, "rb") as handle:
            audio_bytes = handle.read()

        body = b"".join(
            [
                self._encode_file(
                    boundary,
                    "audio",
                    file_name,
                    content_type,
                    audio_bytes,
                ),
                self._encode_field(boundary, "definition", definition),
                f"--{boundary}--\r\n".encode("utf-8"),
            ]
        )

        http_400_retried = False
        transport_retry_delays = iter(MAI_TRANSPORT_RETRY_DELAYS_SECONDS)
        transport_retry_count = 0
        while True:
            http_request = request.Request(
                self._transcription_url(),
                method="POST",
                headers=self._transcription_headers(boundary),
                data=body,
            )
            try:
                with self.urlopen(  # noqa: S310
                    http_request,
                    timeout=self.timeout_seconds,
                ) as response:
                    return self._normalize_transcription_payload(
                        json.loads(response.read().decode("utf-8"))
                    )
            except urllib.error.HTTPError as error:
                details = error.read().decode("utf-8", errors="replace").strip()
                if error.code == 400 and not http_400_retried:
                    http_400_retried = True
                    self.retry_sleep(MAI_HTTP_400_RETRY_DELAY_SECONDS)
                    continue
                message = (
                    f"{self.provider_label} transcription failed with status {error.code}"
                )
                if details:
                    message = f"{message}: {details}"
                raise RuntimeError(message) from error
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                try:
                    delay_seconds = next(transport_retry_delays)
                except StopIteration:
                    raise RuntimeError(
                        f"{self.provider_label} transcription transport failed after "
                        f"{transport_retry_count} retries: {error}"
                    ) from error
                transport_retry_count += 1
                self.retry_sleep(delay_seconds)

    def _normalize_transcription_payload(self, payload: dict) -> dict:
        phrases = payload.get("phrases") or []
        combined = payload.get("combinedPhrases") or []
        text = " ".join(
            str(item.get("text") or "").strip() for item in combined
        ).strip()
        if not text:
            text = " ".join(
                str(item.get("text") or "").strip() for item in phrases
            ).strip()
        language = next(
            (
                str(item.get("locale") or "").strip()
                for item in phrases
                if str(item.get("locale") or "").strip()
            ),
            "unknown",
        )
        return {
            "text": text,
            "language": language,
        }
