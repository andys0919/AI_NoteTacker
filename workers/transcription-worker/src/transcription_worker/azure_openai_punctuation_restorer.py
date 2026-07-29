from difflib import SequenceMatcher
import gzip
import re

from transcription_worker.azure_openai_responses import (
    AzureOpenAiResponsesHttpError,
    extract_output_text,
    extract_token_usage,
    request_response,
)

DEFAULT_POLISHING_SYSTEM_PROMPT = (
    "你是忠實的會議逐字稿校稿助手。請保留每一句實際說出的內容與原本語言，不要翻譯、"
    "摘要、刪句、合併事實或補入錄音中沒有的資訊。只修正從上下文可明確判斷的 ASR "
    "同音錯字、技術詞拼寫、英文大小寫、標點與分句；不確定就保留原字。所有數字與順序"
    "必須保持不變，中文使用正體中文。直接輸出校稿後逐字稿，不要說明或前後綴。"
)
DEFAULT_PUNCTUATION_SYSTEM_PROMPT = DEFAULT_POLISHING_SYSTEM_PROMPT

_PUNCTUATION_AND_WHITESPACE = "，。、？！；：「」『』（）()【】《》…—－,.!?;:　 \t\r\n"
_MIN_POLISH_SIMILARITY = 0.82
_MIN_POLISH_LENGTH_RATIO = 0.85
_MAX_POLISH_LENGTH_RATIO = 1.15
_REPETITIVE_GZIP_RATIO = 4.0


def _strip_punctuation_and_whitespace(text: str) -> str:
    return "".join(ch for ch in text if ch not in _PUNCTUATION_AND_WHITESPACE)


def _compact_text(text: str) -> str:
    return "".join(char.lower() for char in text if char.isalnum())


def _is_safe_polish(source: str, candidate: str) -> bool:
    source_compact = _compact_text(source)
    candidate_compact = _compact_text(candidate)
    if not source_compact or not candidate_compact:
        return source_compact == candidate_compact
    if re.sub(r"\D", "", source) != re.sub(r"\D", "", candidate):
        return False

    length_ratio = len(candidate_compact) / len(source_compact)
    if not _MIN_POLISH_LENGTH_RATIO <= length_ratio <= _MAX_POLISH_LENGTH_RATIO:
        return False
    matcher = SequenceMatcher(None, source_compact, candidate_compact)
    if matcher.ratio() < _MIN_POLISH_SIMILARITY:
        return False
    deleted = {
        source_compact[source_start:source_end]
        for tag, source_start, source_end, _, _ in matcher.get_opcodes()
        if tag == "delete"
    }
    inserted = {
        candidate_compact[candidate_start:candidate_end]
        for tag, _, _, candidate_start, candidate_end in matcher.get_opcodes()
        if tag == "insert"
    }
    if deleted & inserted:
        return False

    encoded = candidate_compact.encode("utf-8")
    return len(encoded) / len(gzip.compress(encoded)) <= _REPETITIVE_GZIP_RATIO


class AzureOpenAiPunctuationRestorer:
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        urlopen=None,
        max_chars: int = 400,
        system_prompt: str = DEFAULT_POLISHING_SYSTEM_PROMPT,
        reasoning_effort: str = "max",
        timeout_seconds: int = 300,
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._urlopen = urlopen
        self._max_chars = max(1, max_chars)
        self._system_prompt = system_prompt
        self._reasoning_effort = reasoning_effort
        self._timeout_seconds = timeout_seconds

    def restore(self, text: str) -> str:
        return self.restore_with_usage(text)["text"]

    def restore_with_usage(self, text: str) -> dict:
        aggregate = {
            "model": self._model,
            "reasoning_effort": self._reasoning_effort,
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "output_tokens": 0,
            "reasoning_output_tokens": 0,
            "total_tokens": 0,
            "request_count": 0,
            "accepted_chunk_count": 0,
            "fallback_chunk_count": 0,
            "unmetered_request_count": 0,
        }
        if not text or not text.strip():
            return {"text": text, "lexical_changed": False, "usage": aggregate}

        restored_chunks = []
        lexical_changed = False
        for chunk in self._split_by_length(text):
            result = self._restore_chunk(chunk)
            restored_chunks.append(result["text"])
            lexical_changed = lexical_changed or result["lexical_changed"]
            for field in (
                "input_tokens",
                "cached_input_tokens",
                "output_tokens",
                "reasoning_output_tokens",
                "total_tokens",
                "request_count",
                "accepted_chunk_count",
                "fallback_chunk_count",
                "unmetered_request_count",
            ):
                aggregate[field] += result["usage"][field]

        return {
            "text": "".join(restored_chunks),
            "lexical_changed": lexical_changed,
            "usage": aggregate,
        }

    def _split_by_length(self, text: str) -> list[str]:
        return [text[i : i + self._max_chars] for i in range(0, len(text), self._max_chars)]

    def _restore_chunk(self, chunk: str) -> dict:
        usage = {
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "output_tokens": 0,
            "reasoning_output_tokens": 0,
            "total_tokens": 0,
            "request_count": 1,
            "accepted_chunk_count": 0,
            "fallback_chunk_count": 0,
            "unmetered_request_count": 0,
        }
        metered = False
        try:
            payload, request_count, unmetered_request_count = self._call(chunk)
            usage["request_count"] = request_count
            usage["unmetered_request_count"] = unmetered_request_count
            token_usage = extract_token_usage(payload)
            usage.update(token_usage)
            metered = True
            restored = extract_output_text(payload)
        except Exception as error:
            usage["request_count"] = getattr(
                error, "provider_request_count", usage["request_count"]
            )
            usage["fallback_chunk_count"] = 1
            if not metered:
                usage["unmetered_request_count"] = getattr(
                    error, "unmetered_request_count", usage["request_count"]
                )
            return {"text": chunk, "lexical_changed": False, "usage": usage}

        if restored and _is_safe_polish(chunk, restored):
            usage["accepted_chunk_count"] = 1
            usage["fallback_chunk_count"] = 0
            return {
                "text": restored,
                "lexical_changed": (
                    _strip_punctuation_and_whitespace(restored)
                    != _strip_punctuation_and_whitespace(chunk)
                ),
                "usage": usage,
            }

        usage["fallback_chunk_count"] = 1
        return {"text": chunk, "lexical_changed": False, "usage": usage}

    def _call(self, chunk: str) -> tuple[dict, int, int]:
        options = {
            "endpoint": self._endpoint,
            "api_key": self._api_key,
            "model": self._model,
            "instructions": self._system_prompt,
            "user_input": chunk,
            "reasoning_effort": self._reasoning_effort,
            "timeout_seconds": self._timeout_seconds,
            "urlopen": self._urlopen,
        }
        try:
            return request_response(**options), 1, 0
        except AzureOpenAiResponsesHttpError as error:
            if error.status_code != 400:
                raise
            try:
                return request_response(**options), 2, 1
            except Exception as retry_error:
                retry_error.provider_request_count = 2
                retry_error.unmetered_request_count = 2
                raise
