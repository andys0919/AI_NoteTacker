import json
import mimetypes
import os
import time
import uuid
import urllib.error
from urllib import request

from transcription_worker.azure_openai_transcriber import (
    AzureOpenAiTranscriber,
    TranscriptionUsageError,
)


# Diarization speaker ids are scoped to one request, so the chunk boundary decides how
# often the numbering restarts. 25 minutes is the largest window measured to succeed on
# every sampled recording (30 minutes passed on one file, 35 failed; another file passed
# at 50 and failed at 60), and it keeps a whole 171 MB PCM upload well inside the limit.
MAI_CHUNK_DURATION_MS = 1_500_000
MAI_CHUNK_OVERLAP_MS = 180_000
# Azure Speech accepts up to 300 MB; staying on 16 kHz PCM avoids the transcription and
# diarization quality loss measured on lossy chunk uploads.
MAI_MAX_UPLOAD_BYTES = 280 * 1024 * 1024
MAI_MAX_WORKERS = 3
MAI_HTTP_400_RETRY_DELAY_SECONDS = 2.0
MAI_TRANSPORT_RETRY_DELAYS_SECONDS = (2.0, 10.0, 30.0)
MAI_DIARIZATION_ERROR_CODES = ("diarization_unavailable", "diarization service")
MAI_MAX_PHRASE_LIST_TERMS = 100


class MaiTranscriber(AzureOpenAiTranscriber):
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str = "MAI-Transcribe-2",
        api_version: str = "2025-10-15",
        timeout_seconds: int = 300,
        retry_sleep=None,
        diarization_enabled: bool = True,
        **kwargs,
    ) -> None:
        super().__init__(
            endpoint=endpoint,
            deployment=model,
            api_key=api_key,
            api_version=api_version,
            timeout_seconds=timeout_seconds,
            max_chunk_duration_ms=MAI_CHUNK_DURATION_MS,
            chunk_overlap_ms=MAI_CHUNK_OVERLAP_MS,
            max_upload_bytes=MAI_MAX_UPLOAD_BYTES,
            chunk_audio_format="wav",
            independent_chunk_max_workers=MAI_MAX_WORKERS,
            provider_label=f"Azure Speech {model}",
            provider="azure-speech-mai-transcribe-1.5",
            retry_sleep=retry_sleep,
            **kwargs,
        )
        self.retry_sleep = retry_sleep or time.sleep
        self.diarization_enabled = diarization_enabled

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

    def _billed_audio_ms(self, part: dict) -> int:
        duration_ms = self._part_duration_ms(part)
        return ((duration_ms + 999) // 1_000) * 1_000

    @staticmethod
    def _glossary_phrases(workflow_context) -> list[str]:
        """Operator-accepted glossary terms, sent as provider keyword biasing.

        The same terms already drive display aliases after the fact; sending them up
        front lets the provider hear them correctly instead of only rewriting them.
        Unaccepted candidates are review material, not truth, so they stay out.
        """
        phrases: list[str] = []
        for entry in (workflow_context or {}).get("glossary") or []:
            if not isinstance(entry, dict) or not entry.get("accepted"):
                continue
            term = str(entry.get("term") or "").strip()
            if term and term not in phrases:
                phrases.append(term)
        return phrases[:MAI_MAX_PHRASE_LIST_TERMS]

    def _build_definition(self, workflow_context=None, diarize: bool = True) -> str:
        definition: dict = {
            "enhancedMode": {
                "enabled": True,
                "model": self.deployment,
                # MAI-Transcribe-2 moved the style under modelOptions; word timestamps
                # are what make the provider return per-phrase offsets at all.
                "modelOptions": {
                    "transcribeStyle": "verbatim",
                    "timestamps": "word",
                },
            }
        }
        if diarize:
            # maxSpeakers is rejected by MAI ("not supported for MAI transcription yet").
            definition["diarization"] = {"enabled": True}
        phrases = self._glossary_phrases(workflow_context)
        if phrases:
            definition["phraseList"] = {"phrases": phrases}
        return json.dumps(definition, separators=(",", ":"))

    @staticmethod
    def _is_diarization_failure(details: str) -> bool:
        lowered = (details or "").lower()
        return any(code in lowered for code in MAI_DIARIZATION_ERROR_CODES)

    def _transcribe_upload(
        self,
        upload_path: str,
        request_prompt: str = "",
        on_provider_request=None,
        request_usage: dict | None = None,
        workflow_context=None,
        diarize: bool | None = None,
    ) -> dict:
        boundary = f"----AINoteTacker{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(upload_path)[0] or "application/octet-stream"
        file_name = os.path.basename(upload_path)
        diarize = self.diarization_enabled if diarize is None else diarize

        with open(upload_path, "rb") as handle:
            audio_bytes = handle.read()

        def build_body(with_diarization: bool) -> bytes:
            return b"".join(
                [
                    self._encode_file(
                        boundary,
                        "audio",
                        file_name,
                        content_type,
                        audio_bytes,
                    ),
                    self._encode_field(
                        boundary,
                        "definition",
                        self._build_definition(
                            workflow_context, diarize=with_diarization
                        ),
                    ),
                    f"--{boundary}--\r\n".encode("utf-8"),
                ]
            )

        body = build_body(diarize)
        diarization_dropped = False
        http_400_retried = False
        transport_retry_delays = iter(MAI_TRANSPORT_RETRY_DELAYS_SECONDS)
        transport_retry_count = 0
        provider_request_count = 0
        while True:
            provider_request_count += 1
            http_status = None
            provider_request_id = None
            request_id = self._start_provider_request(
                on_provider_request, request_usage
            )
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
                    http_status = int(getattr(response, "status", 200))
                    provider_request_id = self._external_request_id(response)
                    payload = self._normalize_transcription_payload(
                        json.loads(response.read().decode("utf-8"))
                    )
            except urllib.error.HTTPError as error:
                details = error.read().decode("utf-8", errors="replace").strip()
                self._finish_provider_request(
                    on_provider_request,
                    {
                        "requestId": request_id,
                        "status": "failed",
                        "providerRequestId": self._external_request_id(error),
                        "httpStatus": error.code,
                        "errorCode": f"http-{error.code}",
                    },
                )
                # Speaker evidence must never cost the transcript: when only the
                # diarization service is unavailable, retry the same audio without it
                # and keep the text. Provider text stays the single authority either way.
                if (
                    diarize
                    and not diarization_dropped
                    and self._is_diarization_failure(details)
                ):
                    diarization_dropped = True
                    body = build_body(False)
                    self.retry_sleep(MAI_HTTP_400_RETRY_DELAY_SECONDS)
                    continue
                if error.code == 400 and not http_400_retried:
                    http_400_retried = True
                    self.retry_sleep(MAI_HTTP_400_RETRY_DELAY_SECONDS)
                    continue
                message = (
                    f"{self.provider_label} transcription failed with status {error.code}"
                )
                if details:
                    message = f"{message}: {details}"
                raise TranscriptionUsageError(
                    message,
                    {
                        "provider_request_count": provider_request_count,
                        "unmetered_request_count": provider_request_count,
                    },
                ) from error
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                self._finish_provider_request(
                    on_provider_request,
                    {
                        "requestId": request_id,
                        "status": "failed",
                        "errorCode": type(error).__name__,
                    },
                )
                try:
                    delay_seconds = next(transport_retry_delays)
                except StopIteration:
                    raise TranscriptionUsageError(
                        f"{self.provider_label} transcription transport failed after "
                        f"{transport_retry_count} retries: {error}",
                        {
                            "provider_request_count": provider_request_count,
                            "unmetered_request_count": provider_request_count,
                        },
                    ) from error
                transport_retry_count += 1
                self.retry_sleep(delay_seconds)
            except Exception as error:
                self._finish_provider_request(
                    on_provider_request,
                    {
                        "requestId": request_id,
                        "status": "failed",
                        "providerRequestId": provider_request_id,
                        "httpStatus": http_status,
                        "errorCode": type(error).__name__,
                    },
                )
                raise TranscriptionUsageError(
                    f"{self.provider_label} transcription returned an invalid response: {error}",
                    {
                        "provider_request_count": provider_request_count,
                        "unmetered_request_count": provider_request_count,
                    },
                ) from error
            else:
                self._finish_provider_request(
                    on_provider_request,
                    {
                        "requestId": request_id,
                        "status": "succeeded",
                        "providerRequestId": provider_request_id,
                        "httpStatus": http_status,
                        "usage": request_usage,
                    },
                )
                payload["_transcription_usage"] = {
                    "provider_request_count": provider_request_count,
                    "unmetered_request_count": provider_request_count - 1,
                }
                return payload

    @staticmethod
    def _phrase_timing_ms(item: dict) -> tuple[int, int] | None:
        """Start/end of one phrase in milliseconds, or None when the provider gave no timing.

        MAI-Transcribe-2 was observed returning a whole chunk whose phrases all carry
        offset 0 / duration 0 while the word timestamps inside them are correct; trusting
        the phrase fields stacked 25 minutes of speech at one instant and lost it. The
        words are therefore the authority whenever the phrase timing is absent or empty.
        """
        words = [word for word in (item.get("words") or []) if word.get("offsetMilliseconds") is not None]
        if words:
            first = int(words[0]["offsetMilliseconds"])
            last = words[-1]
            last_end = int(last["offsetMilliseconds"]) + int(last.get("durationMilliseconds") or 0)
            if last_end > first:
                return first, last_end
        offset_ms = item.get("offsetMilliseconds")
        duration_ms = int(item.get("durationMilliseconds") or 0)
        if offset_ms is None or (int(offset_ms) == 0 and duration_ms == 0 and words):
            return None
        return int(offset_ms), int(offset_ms) + duration_ms

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
        if language.lower().startswith("zh"):
            language = "zh-Hant"

        # Every phrase carries a real provider offset, so keep them as segments instead
        # of collapsing to one blob and re-deriving timings from character counts.
        segments = []
        for item in phrases:
            phrase_text = str(item.get("text") or "").strip()
            timing = self._phrase_timing_ms(item)
            if not phrase_text or timing is None:
                continue
            start_ms, end_ms = timing
            segment = {
                "start": start_ms / 1000,
                "end": end_ms / 1000,
                "text": phrase_text,
            }
            if item.get("speaker") is not None:
                segment["speaker"] = item["speaker"]
            segments.append(segment)

        result = {
            "text": text,
            "language": language,
        }
        if segments:
            result["segments"] = segments
        return result
