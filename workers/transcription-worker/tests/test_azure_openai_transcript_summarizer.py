import io
import json
import unittest

from transcription_worker.azure_openai_transcript_summarizer import (
    AzureOpenAiSummaryError,
    AzureOpenAiTranscriptSummarizer,
)


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class AzureOpenAiTranscriptSummarizerTests(unittest.TestCase):
    def test_posts_responses_request_and_maps_structured_summary(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["url"] = http_request.full_url
            captured["headers"] = dict(http_request.header_items())
            captured["body"] = json.loads(http_request.data.decode("utf-8"))
            summary_json = json.dumps(
                {
                    "summary": "已整理完整會議摘要",
                    "key_points": ["確認需求範圍", "下週交付報價"],
                    "action_items": ["Andy 提供正式報價"],
                    "decisions": ["先做 PoC"],
                    "risks": ["時程緊迫"],
                    "open_questions": ["客戶何時提供樣品？"],
                }
            )
            # Azure Responses API shape: `output` interleaves a reasoning item with
            # the assistant message, whose `output_text` carries the answer.
            payload = {
                "status": "completed",
                "model": "gpt-5.6-luna",
                "output": [
                    {"type": "reasoning", "content": []},
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": summary_json}],
                    },
                ],
                "usage": {
                    "input_tokens": 1200,
                    "input_tokens_details": {"cached_tokens": 200},
                    "output_tokens": 300,
                    "output_tokens_details": {"reasoning_tokens": 100},
                    "total_tokens": 1500,
                },
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        result = summarizer.summarize(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 1000, "text": "討論導入時程與報價"}],
            },
            summary_profile="sales",
            model_override="gpt-5.6-luna",
        )

        self.assertEqual(
            captured["url"],
            "https://azure.example.test/openai/v1/responses",
        )
        self.assertEqual(captured["headers"]["Api-key"], "secret")
        self.assertEqual(captured["body"]["model"], "gpt-5.6-luna")
        self.assertIn("summarizer", captured["body"]["instructions"].lower())
        self.assertIn("sales follow-up", captured["body"]["input"].lower())
        self.assertEqual(result["model"], "gpt-5.6-luna")
        self.assertEqual(result["structured"]["action_items"], ["Andy 提供正式報價"])
        self.assertIn("## Decisions", result["text"])
        # Responses usage (input/output tokens) is mapped for cost tracking.
        self.assertEqual(result["usage"]["prompt_tokens"], 1200)
        self.assertEqual(result["usage"].get("cached_prompt_tokens"), 200)
        self.assertEqual(result["usage"]["completion_tokens"], 300)
        self.assertEqual(result["usage"].get("reasoning_completion_tokens"), 100)
        self.assertEqual(result["usage"]["total_tokens"], 1500)

    def test_raises_when_no_output_text(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            payload = {"status": "completed", "output": [{"type": "reasoning", "content": []}]}
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaises(RuntimeError):
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

    def test_applies_configured_summary_timeout(self) -> None:
        captured = {}

        def fake_urlopen(_http_request, timeout=None):
            captured["timeout"] = timeout
            payload = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "summary": "摘要",
                                        "key_points": [],
                                        "action_items": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                    }
                                ),
                            }
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 1,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens": 1,
                    "output_tokens_details": {"reasoning_tokens": 0},
                    "total_tokens": 2,
                },
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        try:
            summarizer = AzureOpenAiTranscriptSummarizer(
                endpoint="https://azure.example.test/openai/v1/responses",
                api_key="secret",
                model="gpt-5.6-luna",
                timeout_seconds=45,
                urlopen=fake_urlopen,
            )
        except TypeError as error:
            self.fail(str(error))

        summarizer.summarize(
            {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
        )

        self.assertEqual(captured["timeout"], 45)

    def test_raises_when_token_usage_is_missing(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            payload = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "summary": "摘要",
                                        "key_points": [],
                                        "action_items": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                    }
                                ),
                            }
                        ],
                    }
                ],
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(RuntimeError, "usage"):
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

    def test_raises_when_token_usage_fields_are_missing(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            payload = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "summary": "摘要",
                                        "key_points": [],
                                        "action_items": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                    }
                                ),
                            }
                        ],
                    }
                ],
                "usage": {},
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(RuntimeError, "usage"):
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

    def test_raises_when_token_usage_is_not_non_negative_integers(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            payload = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "summary": "摘要",
                                        "key_points": [],
                                        "action_items": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                    }
                                ),
                            }
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": "10",
                    "output_tokens": 2,
                    "total_tokens": 12,
                },
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(RuntimeError, "usage"):
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

    def test_reports_malformed_output_as_an_azure_error(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
            payload = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "not json"}],
                    }
                ],
                "usage": {
                    "input_tokens": 10,
                    "input_tokens_details": {"cached_tokens": 2},
                    "output_tokens": 2,
                    "output_tokens_details": {"reasoning_tokens": 1},
                    "total_tokens": 12,
                },
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(AzureOpenAiSummaryError, "azure openai") as raised:
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

        self.assertEqual(
            raised.exception.usage,
            {
                "input_tokens": 10,
                "cached_input_tokens": 2,
                "output_tokens": 2,
                "reasoning_output_tokens": 1,
                "total_tokens": 12,
            },
        )

    def test_rejects_incomplete_or_mistyped_schema_and_preserves_usage(self) -> None:
        valid_usage = {
            "input_tokens": 10,
            "input_tokens_details": {"cached_tokens": 2},
            "output_tokens": 2,
            "output_tokens_details": {"reasoning_tokens": 1},
            "total_tokens": 12,
        }
        valid_summary = {
            "summary": "摘要",
            "key_points": [],
            "action_items": [],
            "decisions": [],
            "risks": [],
            "open_questions": [],
        }
        invalid_summaries = {
            "empty object": {},
            "missing field": {
                key: value
                for key, value in valid_summary.items()
                if key != "open_questions"
            },
            "empty summary": {**valid_summary, "summary": "   "},
            "summary wrong type": {**valid_summary, "summary": ["摘要"]},
            "list field wrong type": {**valid_summary, "key_points": "重點"},
            "list item wrong type": {**valid_summary, "key_points": [1]},
        }

        for case_name, invalid_summary in invalid_summaries.items():
            with self.subTest(case=case_name):
                def fake_urlopen(_http_request, timeout=None):
                    payload = {
                        "status": "completed",
                        "output": [
                            {
                                "type": "message",
                                "content": [
                                    {
                                        "type": "output_text",
                                        "text": json.dumps(invalid_summary),
                                    }
                                ],
                            }
                        ],
                        "usage": valid_usage,
                    }
                    return _FakeResponse(json.dumps(payload).encode("utf-8"))

                summarizer = AzureOpenAiTranscriptSummarizer(
                    endpoint="https://azure.example.test/openai/v1/responses",
                    api_key="secret",
                    model="gpt-5.6-luna",
                    urlopen=fake_urlopen,
                )

                with self.assertRaises(AzureOpenAiSummaryError) as raised:
                    summarizer.summarize(
                        {
                            "language": "zh",
                            "segments": [
                                {"start_ms": 0, "end_ms": 1, "text": "x"}
                            ],
                        }
                    )

                self.assertEqual(
                    raised.exception.usage,
                    {
                        "input_tokens": 10,
                        "cached_input_tokens": 2,
                        "output_tokens": 2,
                        "reasoning_output_tokens": 1,
                        "total_tokens": 12,
                    },
                )


if __name__ == "__main__":
    unittest.main()
