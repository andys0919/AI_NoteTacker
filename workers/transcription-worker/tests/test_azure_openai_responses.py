import io
import json
import unittest

from transcription_worker.azure_openai_responses import (
    extract_output_text,
    extract_token_usage,
    request_response,
)


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class AzureOpenAiResponsesTests(unittest.TestCase):
    def test_disables_response_storage(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["body"] = json.loads(http_request.data.decode("utf-8"))
            return _FakeResponse(b"{}")

        request_response(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            user_input="private meeting transcript",
            urlopen=fake_urlopen,
        )

        self.assertIs(captured["body"].get("store"), False)

    def test_applies_a_finite_default_http_timeout(self) -> None:
        captured = {}

        def fake_urlopen(_http_request, timeout=None):
            captured["timeout"] = timeout
            return _FakeResponse(b"{}")

        request_response(
            endpoint="https://azure.example.test/openai/v1/responses",
            api_key="secret",
            model="gpt-5.6-luna",
            user_input="meeting transcript",
            urlopen=fake_urlopen,
        )

        self.assertEqual(captured["timeout"], 300)

    def test_does_not_retry_a_transport_failure(self) -> None:
        calls = 0

        def fake_urlopen(_http_request, timeout=None):
            nonlocal calls
            calls += 1
            raise TimeoutError("timed out")

        with self.assertRaises(TimeoutError):
            request_response(
                endpoint="https://azure.example.test/openai/v1/responses",
                api_key="secret",
                model="gpt-5.6-luna",
                user_input="meeting transcript",
                urlopen=fake_urlopen,
            )

        self.assertEqual(calls, 1)

    def test_concatenates_output_text_blocks_without_inserting_characters(self) -> None:
        payload = {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": '{"summary":"hel'},
                        {"type": "output_text", "text": 'lo"}'},
                    ],
                }
            ],
        }

        self.assertEqual(extract_output_text(payload), '{"summary":"hello"}')

    def test_rejects_non_completed_response_with_partial_output(self) -> None:
        payload = {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "partial"}],
                }
            ],
        }

        with self.assertRaisesRegex(RuntimeError, "incomplete.*max_output_tokens"):
            extract_output_text(payload)

    def test_extracts_cached_input_and_reasoning_token_breakdown(self) -> None:
        payload = {
            "usage": {
                "input_tokens": 10,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens": 6,
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 16,
            }
        }

        self.assertEqual(
            extract_token_usage(payload),
            {
                "input_tokens": 10,
                "cached_input_tokens": 4,
                "output_tokens": 6,
                "reasoning_output_tokens": 2,
                "total_tokens": 16,
            },
        )

    def test_rejects_invalid_token_breakdown(self) -> None:
        payload = {
            "usage": {
                "input_tokens": 10,
                "input_tokens_details": {"cached_tokens": "4"},
                "output_tokens": 6,
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 16,
            }
        }

        try:
            extract_token_usage(payload)
        except RuntimeError as error:
            self.assertIn("usage", str(error))
        except Exception as error:
            self.fail(f"unexpected error type: {type(error).__name__}")
        else:
            self.fail("RuntimeError not raised")

    def test_rejects_token_breakdown_larger_than_parent_totals(self) -> None:
        payload = {
            "usage": {
                "input_tokens": 10,
                "input_tokens_details": {"cached_tokens": 11},
                "output_tokens": 6,
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 16,
            }
        }

        try:
            extract_token_usage(payload)
        except RuntimeError as error:
            self.assertIn("usage", str(error))
        except Exception as error:
            self.fail(f"unexpected error type: {type(error).__name__}")
        else:
            self.fail("RuntimeError not raised")

    def test_rejects_non_object_token_breakdown(self) -> None:
        payload = {
            "usage": {
                "input_tokens": 10,
                "input_tokens_details": ["invalid"],
                "output_tokens": 6,
                "total_tokens": 16,
            }
        }

        try:
            extract_token_usage(payload)
        except RuntimeError as error:
            self.assertIn("usage", str(error))
        except Exception as error:
            self.fail(f"unexpected error type: {type(error).__name__}")
        else:
            self.fail("RuntimeError not raised")

    def test_rejects_missing_required_token_breakdown_fields(self) -> None:
        for usage in (
            {
                "input_tokens": 10,
                "output_tokens": 6,
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 16,
            },
            {
                "input_tokens": 10,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens": 6,
                "total_tokens": 16,
            },
            {
                "input_tokens": 10,
                "input_tokens_details": {},
                "output_tokens": 6,
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 16,
            },
            {
                "input_tokens": 10,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens": 6,
                "output_tokens_details": {},
                "total_tokens": 16,
            },
        ):
            with self.subTest(usage=usage):
                with self.assertRaisesRegex(RuntimeError, "usage"):
                    extract_token_usage({"usage": usage})

    def test_rejects_inconsistent_total_token_count(self) -> None:
        payload = {
            "usage": {
                "input_tokens": 10,
                "output_tokens": 6,
                "total_tokens": 99,
            }
        }

        with self.assertRaisesRegex(RuntimeError, "usage"):
            extract_token_usage(payload)


if __name__ == "__main__":
    unittest.main()
