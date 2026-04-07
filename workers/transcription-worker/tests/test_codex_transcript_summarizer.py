import unittest

from transcription_worker.codex_transcript_summarizer import CodexTranscriptSummarizer


class _FakeCompletedProcess:
    def __init__(self, stdout: str, stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


class CodexTranscriptSummarizerTests(unittest.TestCase):
    def test_returns_structured_summary_and_markdown_text(self) -> None:
        def fake_runner(*_args, **_kwargs):
            return _FakeCompletedProcess(
                '\n'.join(
                    [
                        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"討論產品上線時程。\\",\\"key_points\\":[\\"需要完成 QA\\"],\\"action_items\\":[\\"Andy 更新發布清單\\"],\\"decisions\\":[\\"先上 beta\\"],\\"risks\\":[\\"時程壓縮\\"],\\"open_questions\\":[\\"誰負責對外公告？\\"]}"}}'
                    ]
                )
            )

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.3-codex-spark",
            reasoning_effort="medium",
            runner=fake_runner,
        )

        result = summarizer.summarize(
            {
                "language": "zh",
                "segments": [
                    {"start_ms": 0, "end_ms": 1000, "text": "討論產品上線時程"}
                ],
            }
        )

        self.assertEqual(result["structured"]["action_items"], ["Andy 更新發布清單"])
        self.assertEqual(result["structured"]["decisions"], ["先上 beta"])
        self.assertEqual(result["structured"]["risks"], ["時程壓縮"])
        self.assertIn("## Decisions", result["text"])
        self.assertIn("## Risks", result["text"])


if __name__ == "__main__":
    unittest.main()
