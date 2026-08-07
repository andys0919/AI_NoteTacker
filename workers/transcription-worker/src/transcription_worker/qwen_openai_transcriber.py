import re

from transcription_worker.azure_openai_transcriber import AzureOpenAiTranscriber


QWEN_CHUNK_DURATION_MS = 60_000
_QWEN_ASR_MARKER = re.compile(
    r"language\s+([^<\r\n]+?)<asr_text>",
    flags=re.IGNORECASE,
)


def _qwen_language_code(value: str) -> str:
    normalized = " ".join(value.strip().lower().replace("-", " ").split())
    if "cantonese" in normalized:
        return "yue"
    if "min nan" in normalized or "taiwanese" in normalized:
        return "nan"
    if "chinese" in normalized or normalized == "mandarin":
        return "zh"
    return {
        "english": "en",
        "japanese": "ja",
        "korean": "ko",
    }.get(normalized, normalized or "unknown")


class QwenOpenAiTranscriber(AzureOpenAiTranscriber):
    def __init__(self, endpoint: str, model: str, timeout_seconds: int = 300, **kwargs) -> None:
        super().__init__(
            endpoint=endpoint,
            deployment=model,
            api_key="",
            timeout_seconds=timeout_seconds,
            max_chunk_duration_ms=QWEN_CHUNK_DURATION_MS,
            provider_label="Qwen3-ASR",
            provider="qwen3-asr-1.7b",
            **kwargs,
        )

    def _transcription_url(self) -> str:
        return f"{self.endpoint}/v1/audio/transcriptions"

    def _transcription_headers(self, boundary: str) -> dict[str, str]:
        return {
            "content-type": f"multipart/form-data; boundary={boundary}",
        }

    def _build_request_prompt(self, workflow_context) -> str:
        return ""

    def _normalize_transcription_payload(self, payload: dict) -> dict:
        text = str(payload.get("text") or "")
        languages = _QWEN_ASR_MARKER.findall(text)
        return {
            **payload,
            "text": _QWEN_ASR_MARKER.sub("", text).strip(),
            "language": (
                payload.get("language")
                or (_qwen_language_code(languages[0]) if languages else "unknown")
            ),
        }
