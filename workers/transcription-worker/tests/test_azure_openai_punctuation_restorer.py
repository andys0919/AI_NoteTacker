import io
import json
import unittest

from transcription_worker.azure_openai_punctuation_restorer import (
    AzureOpenAiPunctuationRestorer,
)


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _chat_response(content: str) -> _FakeResponse:
    payload = {"choices": [{"message": {"content": content}}]}
    return _FakeResponse(json.dumps(payload).encode("utf-8"))


class AzureOpenAiPunctuationRestorerTests(unittest.TestCase):
    def test_posts_chunk_to_chat_endpoint_and_returns_punctuated_text(self) -> None:
        captured = {}

        def fake_urlopen(http_request):
            captured["url"] = http_request.full_url
            captured["headers"] = dict(http_request.header_items())
            captured["body"] = json.loads(http_request.data.decode("utf-8"))
            return _chat_response("你好，今天天氣很好。")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/chat/completions",
            api_key="secret",
            model="gpt-5.4-mini",
            urlopen=fake_urlopen,
        )

        result = restorer.restore("你好今天天氣很好")

        self.assertEqual(result, "你好，今天天氣很好。")
        self.assertEqual(captured["url"], "https://azure.example.test/openai/v1/chat/completions")
        self.assertEqual(captured["headers"]["Api-key"], "secret")
        self.assertEqual(captured["body"]["model"], "gpt-5.4-mini")
        self.assertEqual(captured["body"]["messages"][1]["content"], "你好今天天氣很好")

    def test_keeps_raw_text_when_model_alters_words(self) -> None:
        # Model dropped/changed a character -> fidelity guard must reject the rewrite.
        def fake_urlopen(_http_request):
            return _chat_response("你好，今天天氣。")  # 少了「很好」

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.4-mini",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("你好今天天氣很好"), "你好今天天氣很好")

    def test_keeps_raw_text_when_chat_call_fails(self) -> None:
        def fake_urlopen(_http_request):
            raise RuntimeError("boom")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.4-mini",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("你好今天天氣很好"), "你好今天天氣很好")

    def test_chunks_long_text_and_concatenates_results(self) -> None:
        calls = []

        def fake_urlopen(http_request):
            chunk = json.loads(http_request.data.decode("utf-8"))["messages"][1]["content"]
            calls.append(chunk)
            return _chat_response(chunk + "。")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.4-mini",
            urlopen=fake_urlopen,
            max_chars=3,
        )

        result = restorer.restore("AABBCCDD")

        self.assertEqual(calls, ["AAB", "BCC", "DD"])
        self.assertEqual(result, "AAB。BCC。DD。")

    def test_returns_blank_text_unchanged_without_calling_chat(self) -> None:
        def fake_urlopen(_http_request):
            raise AssertionError("should not be called for blank input")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.4-mini",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("   "), "   ")


if __name__ == "__main__":
    unittest.main()
