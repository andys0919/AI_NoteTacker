from transcription_worker.azure_openai_responses import (
    extract_output_text,
    extract_token_usage,
    request_response,
)

# gpt-4o-transcribe 對快速口語長音訊常回傳「無標點」的整段文字，且 prompt 無法可靠
# 誘導標點（範例式 prompt 還會被模型複讀）。因此改以 Azure Responses API 做一道
# 後處理：只補標點、不改字。system prompt 已實測能在 100% 保真下加上標點與分句。
DEFAULT_PUNCTUATION_SYSTEM_PROMPT = (
    "你是繁體中文標點修復助手。在「絕對不改變、不增刪、不重排任何字詞」的前提下，"
    "只為使用者提供的會議逐字稿加上正確的標點符號（，。、？！；：），"
    "並在語意自然處換行分句。直接輸出修復後的文字，不要任何說明或前後綴。"
)

# 後處理只允許新增這些「標點與空白」字元；比對時把它們去掉，確認模型沒動到任何字詞。
_PUNCTUATION_AND_WHITESPACE = "，。、？！；：「」『』（）()【】《》…—－　 \t\r\n"


def _strip_punctuation_and_whitespace(text: str) -> str:
    return "".join(ch for ch in text if ch not in _PUNCTUATION_AND_WHITESPACE)


class AzureOpenAiPunctuationRestorer:
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        urlopen=None,
        max_chars: int = 400,
        system_prompt: str = DEFAULT_PUNCTUATION_SYSTEM_PROMPT,
        timeout_seconds: int = 30,
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._urlopen = urlopen
        self._max_chars = max(1, max_chars)
        self._system_prompt = system_prompt
        self._timeout_seconds = timeout_seconds

    def restore(self, text: str) -> str:
        return self.restore_with_usage(text)["text"]

    def restore_with_usage(self, text: str) -> dict:
        aggregate = {
            "model": self._model,
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
            return {"text": text, "usage": aggregate}

        restored_chunks = []
        for chunk in self._split_by_length(text):
            result = self._restore_chunk(chunk)
            restored_chunks.append(result["text"])
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

        return {"text": "".join(restored_chunks), "usage": aggregate}

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
            payload = self._call(chunk)
            token_usage = extract_token_usage(payload)
            usage.update(token_usage)
            metered = True
            restored = extract_output_text(payload)
        except Exception:
            # Punctuation is a best-effort enhancement: on any failure keep the raw
            # text so a flaky Responses call can never fail the whole transcription job.
            usage["fallback_chunk_count"] = 1
            if not metered:
                usage["unmetered_request_count"] = 1
            return {"text": chunk, "usage": usage}

        # Fidelity guard: only accept the rewrite when it adds *nothing but*
        # punctuation/whitespace. If the model changed, dropped, or hallucinated any
        # word, discard it and keep the raw chunk — never corrupt the transcript.
        if restored and _strip_punctuation_and_whitespace(restored) == _strip_punctuation_and_whitespace(chunk):
            usage["accepted_chunk_count"] = 1
            usage["fallback_chunk_count"] = 0
            return {"text": restored, "usage": usage}

        usage["fallback_chunk_count"] = 1
        return {"text": chunk, "usage": usage}

    def _call(self, chunk: str) -> dict:
        return request_response(
            endpoint=self._endpoint,
            api_key=self._api_key,
            model=self._model,
            instructions=self._system_prompt,
            user_input=chunk,
            timeout_seconds=self._timeout_seconds,
            urlopen=self._urlopen,
        )
