import io
import json
import unittest
import urllib.error

from transcription_worker.azure_openai_punctuation_restorer import (
    AzureOpenAiPunctuationRestorer,
)


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _responses_response(
    text: str,
    *,
    input_tokens: int = 10,
    cached_input_tokens: int = 0,
    output_tokens: int = 2,
    reasoning_output_tokens: int = 0,
    status: str = "completed",
) -> _FakeResponse:
    # Mirror the Azure Responses API shape: the `output` array interleaves a
    # `reasoning` item with the assistant `message`, and only the message's
    # `output_text` content carries the answer.
    payload = {
        "status": status,
        "model": "gpt-5.6-luna",
        "output": [
            {"type": "reasoning", "content": []},
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            },
        ],
        "usage": {
            "input_tokens": input_tokens,
            "input_tokens_details": {"cached_tokens": cached_input_tokens},
            "output_tokens": output_tokens,
            "output_tokens_details": {"reasoning_tokens": reasoning_output_tokens},
            "total_tokens": input_tokens + output_tokens,
        },
    }
    return _FakeResponse(json.dumps(payload).encode("utf-8"))


class AzureOpenAiPunctuationRestorerTests(unittest.TestCase):
    def test_posts_chunk_to_responses_endpoint_and_returns_punctuated_text(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["url"] = http_request.full_url
            captured["headers"] = dict(http_request.header_items())
            captured["body"] = json.loads(http_request.data.decode("utf-8"))
            return _responses_response("你好，今天天氣很好。")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        result = restorer.restore("你好今天天氣很好")

        self.assertEqual(result, "你好，今天天氣很好。")
        self.assertEqual(captured["url"], "https://azure.example.test/openai/v1/responses")
        self.assertEqual(captured["headers"]["Api-key"], "secret")
        self.assertEqual(captured["body"]["model"], "gpt-5.6-luna")
        self.assertEqual(captured["body"]["input"], "你好今天天氣很好")
        self.assertEqual(captured["body"]["reasoning"], {"effort": "max"})
        self.assertIn("標點", captured["body"]["instructions"])

    def test_keeps_raw_text_when_model_alters_words(self) -> None:
        # Model dropped/changed a character -> fidelity guard must reject the rewrite.
        def fake_urlopen(_http_request, timeout=None):
            return _responses_response("你好，今天天氣。")  # 少了「很好」

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("你好今天天氣很好"), "你好今天天氣很好")

    def test_keeps_raw_text_when_responses_call_fails(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            raise RuntimeError("boom")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("你好今天天氣很好"), "你好今天天氣很好")

    def test_chunks_long_text_and_concatenates_results(self) -> None:
        calls = []

        def fake_urlopen(http_request, timeout=None):
            chunk = json.loads(http_request.data.decode("utf-8"))["input"]
            calls.append(chunk)
            return _responses_response(chunk + "。")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
            max_chars=3,
        )

        result = restorer.restore("AABBCCDD")

        self.assertEqual(calls, ["AAB", "BCC", "DD"])
        self.assertEqual(result, "AAB。BCC。DD。")

    def test_returns_blank_text_unchanged_without_calling_responses(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            raise AssertionError("should not be called for blank input")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        self.assertEqual(restorer.restore("   "), "   ")

    def test_applies_configured_punctuation_timeout(self) -> None:
        captured = {}

        def fake_urlopen(_http_request, timeout=None):
            captured["timeout"] = timeout
            return _responses_response("你好。")

        try:
            restorer = AzureOpenAiPunctuationRestorer(
                endpoint="https://azure.example.test/openai/v1/responses",
                api_key="secret",
                model="gpt-5.6-luna",
                timeout_seconds=12,
                urlopen=fake_urlopen,
            )
        except TypeError as error:
            self.fail(str(error))

        self.assertEqual(restorer.restore("你好"), "你好。")
        self.assertEqual(captured["timeout"], 12)

    def test_returns_aggregated_usage_for_all_response_chunks(self) -> None:
        responses = iter(
            [
                _responses_response(
                    "ABC。",
                    input_tokens=5,
                    cached_input_tokens=2,
                    output_tokens=1,
                    reasoning_output_tokens=1,
                ),
                _responses_response(
                    "DEF。",
                    input_tokens=7,
                    cached_input_tokens=3,
                    output_tokens=2,
                    reasoning_output_tokens=1,
                ),
            ]
        )

        def fake_urlopen(_http_request, timeout=None):
            return next(responses)

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            max_chars=3,
            urlopen=fake_urlopen,
        )

        try:
            result = restorer.restore_with_usage("ABCDEF")
        except AttributeError as error:
            self.fail(str(error))

        self.assertEqual(result["text"], "ABC。DEF。")
        self.assertEqual(
            result["usage"],
            {
                "model": "gpt-5.6-luna",
                "reasoning_effort": "max",
                "input_tokens": 12,
                "cached_input_tokens": 5,
                "output_tokens": 3,
                "reasoning_output_tokens": 2,
                "total_tokens": 15,
                "request_count": 2,
                "accepted_chunk_count": 2,
                "fallback_chunk_count": 0,
                "unmetered_request_count": 0,
            },
        )

    def test_fidelity_rejection_keeps_raw_text_and_counts_usage(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            return _responses_response("你好，今天天氣。", input_tokens=9, output_tokens=2)

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        result = restorer.restore_with_usage("你好今天天氣很好")

        self.assertEqual(result["text"], "你好今天天氣很好")
        self.assertEqual(result["usage"]["input_tokens"], 9)
        self.assertEqual(result["usage"]["output_tokens"], 2)
        self.assertEqual(result["usage"]["fallback_chunk_count"], 1)
        self.assertEqual(result["usage"]["unmetered_request_count"], 0)

    def test_incomplete_response_keeps_raw_text_but_counts_reported_usage(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            return _responses_response(
                "你好。",
                input_tokens=8,
                output_tokens=1,
                status="incomplete",
            )

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        result = restorer.restore_with_usage("你好")

        self.assertEqual(result["text"], "你好")
        self.assertEqual(result["usage"]["total_tokens"], 9)
        self.assertEqual(result["usage"]["fallback_chunk_count"], 1)
        self.assertEqual(result["usage"]["unmetered_request_count"], 0)

    def test_network_failure_is_marked_unmetered_instead_of_zero_cost(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            raise TimeoutError("timed out")

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        result = restorer.restore_with_usage("你好")

        self.assertEqual(result["text"], "你好")
        self.assertEqual(result["usage"]["request_count"], 1)
        self.assertEqual(result["usage"]["fallback_chunk_count"], 1)
        self.assertEqual(result["usage"]["unmetered_request_count"], 1)

    def test_http_400_retry_counts_provider_attempts_separately_from_chunk_outcome(
        self,
    ) -> None:
        calls = 0

        def fake_urlopen(http_request, timeout=None):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise urllib.error.HTTPError(
                    url=http_request.full_url,
                    code=400,
                    msg="Bad Request",
                    hdrs=None,
                    fp=io.BytesIO(b'{"error":{"message":"temporary"}}'),
                )
            return _responses_response("你好。")

        result = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        ).restore_with_usage("你好")

        self.assertEqual(result["text"], "你好。")
        self.assertEqual(result["usage"]["request_count"], 2)
        self.assertEqual(result["usage"]["accepted_chunk_count"], 1)
        self.assertEqual(result["usage"]["fallback_chunk_count"], 0)
        self.assertEqual(result["usage"]["unmetered_request_count"], 1)

    def test_http_400_retry_preserves_attempt_count_when_response_usage_is_invalid(
        self,
    ) -> None:
        calls = 0

        def fake_urlopen(http_request, timeout=None):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise urllib.error.HTTPError(
                    url=http_request.full_url,
                    code=400,
                    msg="Bad Request",
                    hdrs=None,
                    fp=io.BytesIO(b'{"error":{"message":"temporary"}}'),
                )
            return _FakeResponse(
                json.dumps(
                    {
                        "status": "completed",
                        "output": [
                            {
                                "type": "message",
                                "content": [{"type": "output_text", "text": "你好。"}],
                            }
                        ],
                    }
                ).encode("utf-8")
            )

        result = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        ).restore_with_usage("你好")

        self.assertEqual(result["text"], "你好")
        self.assertEqual(result["usage"]["request_count"], 2)
        self.assertEqual(result["usage"]["fallback_chunk_count"], 1)
        self.assertEqual(result["usage"]["unmetered_request_count"], 2)

    def test_accepts_small_asr_term_correction_but_rejects_number_changes(self) -> None:
        responses = iter(
            [
                _responses_response("MES 是英業達的製造系統。"),
                _responses_response("機箱有 43 顆硬碟。"),
            ]
        )

        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=lambda _request, timeout=None: next(responses),
        )

        corrected = restorer.restore_with_usage("MES 是音樂達的製造系統。")
        rejected = restorer.restore_with_usage("機箱有 44 顆硬碟。")

        self.assertEqual(corrected["text"], "MES 是英業達的製造系統。")
        self.assertIs(corrected["lexical_changed"], True)
        self.assertEqual(rejected["text"], "機箱有 44 顆硬碟。")
        self.assertIs(rejected["lexical_changed"], False)

    def test_rejects_reordered_words(self) -> None:
        restorer = AzureOpenAiPunctuationRestorer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=lambda _request, timeout=None: _responses_response(
                "今天上午討論硬碟流程測試。"
            ),
        )

        result = restorer.restore_with_usage("今天上午討論硬碟測試流程。")

        self.assertEqual(result["text"], "今天上午討論硬碟測試流程。")
        self.assertIs(result["lexical_changed"], False)


if __name__ == "__main__":
    unittest.main()
