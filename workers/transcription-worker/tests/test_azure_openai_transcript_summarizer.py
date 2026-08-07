import io
import json
import unittest
import urllib.error

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
            captured["timeout"] = timeout
            summary_json = json.dumps(
                {
                    "title": "導入範圍與待確認時程",
                    "summary": "已整理完整會議摘要",
                    "topics": [
                        {
                            "title": "導入範圍",
                            "status": "mixed",
                            "subtopics": [
                                {
                                    "title": "需求與時程",
                                    "details": ["先確認需求範圍", "交付日期仍待確認"],
                                }
                            ],
                            "conclusion": "範圍已確認，日期待確認。",
                        }
                    ],
                    "follow_up_groups": [
                        {
                            "title": "商務交付",
                            "items": ["Andy 提供正式報價"],
                        }
                    ],
                    "decisions": ["先做 PoC"],
                    "risks": ["時程緊迫"],
                    "open_questions": ["客戶何時提供樣品？"],
                    "analysis_notes": ["樣品日期會影響驗證安排。"],
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
                    "input_tokens_details": {
                        "cached_tokens": 200,
                        "cache_write_tokens": 100,
                    },
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
        self.assertEqual(captured["body"]["reasoning"], {"effort": "max"})
        self.assertEqual(captured["timeout"], 900)
        self.assertIn("summarizer", captured["body"]["instructions"].lower())
        self.assertIn("sales follow-up", captured["body"]["input"].lower())
        self.assertEqual(result["model"], "gpt-5.6-luna")
        self.assertEqual(result["reasoning_effort"], "max")
        self.assertEqual(result["structured"]["action_items"], ["Andy 提供正式報價"])
        self.assertEqual(result["structured"]["topics"][0]["status"], "mixed")
        self.assertEqual(
            result["structured"]["follow_up_groups"][0]["title"],
            "商務交付",
        )
        self.assertIn("## 會議紀要", result["text"])
        self.assertIn("## 已確認決議", result["text"])
        # Responses usage (input/output tokens) is mapped for cost tracking.
        self.assertEqual(result["usage"]["prompt_tokens"], 1200)
        self.assertEqual(result["usage"].get("cached_prompt_tokens"), 200)
        self.assertEqual(result["usage"].get("cache_write_prompt_tokens"), 100)
        self.assertEqual(result["usage"]["completion_tokens"], 300)
        self.assertEqual(result["usage"].get("reasoning_completion_tokens"), 100)
        self.assertEqual(result["usage"]["total_tokens"], 1500)
        self.assertEqual(result["usage"]["provider_request_count"], 1)
        self.assertEqual(result["usage"]["unmetered_request_count"], 0)

    def test_does_not_retry_an_http_400(self) -> None:
        calls = 0

        def fake_urlopen(http_request, timeout=None):
            nonlocal calls
            calls += 1
            raise urllib.error.HTTPError(
                url=http_request.full_url,
                code=400,
                msg="Bad Request",
                hdrs=None,
                fp=io.BytesIO(b'{"error":{"message":"Azure detail"}}'),
            )

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(AzureOpenAiSummaryError, "400.*Azure detail") as raised:
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

        self.assertEqual(calls, 1)
        self.assertEqual(raised.exception.usage["provider_request_count"], 1)
        self.assertEqual(raised.exception.usage["unmetered_request_count"], 1)

    def test_does_not_report_a_provider_request_when_audit_start_fails(self) -> None:
        provider_called = False

        def fake_urlopen(_http_request, timeout=None):
            nonlocal provider_called
            provider_called = True
            raise AssertionError("provider must not be called")

        def fail_audit_start(_update):
            raise RuntimeError("request audit unavailable")

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(AzureOpenAiSummaryError, "audit unavailable") as raised:
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]},
                on_provider_request=fail_audit_start,
            )

        self.assertFalse(provider_called)
        self.assertIsNone(raised.exception.usage)

    def test_does_not_retry_a_non_400_http_error(self) -> None:
        calls = 0

        def fake_urlopen(http_request, timeout=None):
            nonlocal calls
            calls += 1
            raise urllib.error.HTTPError(
                url=http_request.full_url,
                code=429,
                msg="Too Many Requests",
                hdrs=None,
                fp=io.BytesIO(b'{"error":{"message":"rate limited"}}'),
            )

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            urlopen=fake_urlopen,
        )

        with self.assertRaisesRegex(AzureOpenAiSummaryError, "429.*rate limited") as raised:
            summarizer.summarize(
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]}
            )

        self.assertEqual(calls, 1)
        self.assertEqual(raised.exception.usage["provider_request_count"], 1)
        self.assertEqual(raised.exception.usage["unmetered_request_count"], 1)

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
                                        "title": "測試摘要",
                                        "summary": "摘要",
                                        "topics": [],
                                        "follow_up_groups": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                        "analysis_notes": [],
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
                                        "title": "測試摘要",
                                        "summary": "摘要",
                                        "topics": [],
                                        "follow_up_groups": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                        "analysis_notes": [],
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
                                        "title": "測試摘要",
                                        "summary": "摘要",
                                        "topics": [],
                                        "follow_up_groups": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                        "analysis_notes": [],
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
                                        "title": "測試摘要",
                                        "summary": "摘要",
                                        "topics": [],
                                        "follow_up_groups": [],
                                        "decisions": [],
                                        "risks": [],
                                        "open_questions": [],
                                        "analysis_notes": [],
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
        updates = []

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
                {"language": "zh", "segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}]},
                on_provider_request=updates.append,
            )

        self.assertEqual(updates[-1]["status"], "failed")
        self.assertEqual(updates[-1]["errorCode"], "response-validation-failed")
        self.assertEqual(updates[-1]["usage"]["totalTokens"], 12)

        self.assertEqual(
            raised.exception.usage,
            {
                "prompt_tokens": 10,
                "cached_prompt_tokens": 2,
                "completion_tokens": 2,
                "reasoning_completion_tokens": 1,
                "total_tokens": 12,
                "provider_request_count": 1,
                "unmetered_request_count": 0,
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
            "title": "測試摘要",
            "summary": "摘要",
            "topics": [],
            "follow_up_groups": [],
            "decisions": [],
            "risks": [],
            "open_questions": [],
            "analysis_notes": [],
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
            "list field wrong type": {**valid_summary, "analysis_notes": "重點"},
            "list item wrong type": {**valid_summary, "analysis_notes": [1]},
            "topic wrong status": {
                **valid_summary,
                "topics": [
                    {
                        "title": "範圍",
                        "status": "done",
                        "subtopics": [{"title": "內容", "details": ["已確認"]}],
                        "conclusion": "完成",
                    }
                ],
            },
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
                updates = []

                with self.assertRaises(AzureOpenAiSummaryError) as raised:
                    summarizer.summarize(
                        {
                            "language": "zh",
                            "segments": [
                                {"start_ms": 0, "end_ms": 1, "text": "x"}
                            ],
                        },
                        on_provider_request=updates.append,
                    )

                self.assertEqual(updates[-1]["status"], "failed")

                self.assertEqual(
                    raised.exception.usage,
                    {
                        "prompt_tokens": 10,
                        "cached_prompt_tokens": 2,
                        "completion_tokens": 2,
                        "reasoning_completion_tokens": 1,
                        "total_tokens": 12,
                        "provider_request_count": 1,
                        "unmetered_request_count": 0,
                    },
                )


if __name__ == "__main__":
    unittest.main()
