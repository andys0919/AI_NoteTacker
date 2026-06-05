import json
from urllib import request

# gpt-4o-transcribe 對快速口語長音訊常回傳「無標點」的整段文字，且 prompt 無法可靠
# 誘導標點（範例式 prompt 還會被模型複讀）。因此改以既有的 Azure chat 管線做一道
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
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._urlopen = urlopen or request.urlopen
        self._max_chars = max(1, max_chars)
        self._system_prompt = system_prompt

    def restore(self, text: str) -> str:
        if not text or not text.strip():
            return text

        return "".join(self._restore_chunk(chunk) for chunk in self._split_by_length(text))

    def _split_by_length(self, text: str) -> list[str]:
        return [text[i : i + self._max_chars] for i in range(0, len(text), self._max_chars)]

    def _restore_chunk(self, chunk: str) -> str:
        try:
            restored = self._call(chunk)
        except Exception:
            # Punctuation is a best-effort enhancement: on any failure keep the raw
            # text so a flaky chat call can never fail the whole transcription job.
            return chunk

        # Fidelity guard: only accept the rewrite when it adds *nothing but*
        # punctuation/whitespace. If the model changed, dropped, or hallucinated any
        # word, discard it and keep the raw chunk — never corrupt the transcript.
        if restored and _strip_punctuation_and_whitespace(restored) == _strip_punctuation_and_whitespace(chunk):
            return restored

        return chunk

    def _call(self, chunk: str) -> str:
        body = json.dumps(
            {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": chunk},
                ],
            }
        ).encode("utf-8")

        http_request = request.Request(
            self._endpoint,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "api-key": self._api_key,
            },
            data=body,
        )

        with self._urlopen(http_request) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))

        return (
            payload.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        )
