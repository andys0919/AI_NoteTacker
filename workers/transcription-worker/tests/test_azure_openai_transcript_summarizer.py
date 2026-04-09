import io
import json
import unittest

from transcription_worker.azure_openai_transcript_summarizer import AzureOpenAiTranscriptSummarizer


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class AzureOpenAiTranscriptSummarizerTests(unittest.TestCase):
    def test_posts_chat_completion_request_and_maps_structured_summary(self) -> None:
        captured = {}

        def fake_urlopen(http_request):
            captured["url"] = http_request.full_url
            captured["headers"] = dict(http_request.header_items())
            captured["body"] = json.loads(http_request.data.decode("utf-8"))
            payload = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "已整理完整會議摘要",
                                    "key_points": ["確認需求範圍", "下週交付報價"],
                                    "action_items": ["Andy 提供正式報價"],
                                    "decisions": ["先做 PoC"],
                                    "risks": ["時程緊迫"],
                                    "open_questions": ["客戶何時提供樣品？"],
                                }
                            )
                        }
                    }
                ]
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint="https://solomon3d.openai.azure.com/openai/v1/chat/completions",
            api_key="secret",
            model="gpt-5-mini",
            urlopen=fake_urlopen,
        )

        result = summarizer.summarize(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 1000, "text": "討論導入時程與報價"}],
            },
            summary_profile="sales",
            model_override="gpt-5.4-nano",
        )

        self.assertEqual(
            captured["url"],
            "https://solomon3d.openai.azure.com/openai/v1/chat/completions",
        )
        self.assertEqual(captured["headers"]["Api-key"], "secret")
        self.assertEqual(captured["body"]["model"], "gpt-5.4-nano")
        self.assertIn("sales follow-up", captured["body"]["messages"][1]["content"].lower())
        self.assertEqual(result["model"], "gpt-5.4-nano")
        self.assertEqual(result["structured"]["action_items"], ["Andy 提供正式報價"])
        self.assertIn("## Decisions", result["text"])


if __name__ == "__main__":
    unittest.main()
