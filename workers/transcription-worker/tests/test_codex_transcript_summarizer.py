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

    def test_applies_summary_profile_guidance_to_the_prompt(self) -> None:
        captured = {}

        def fake_runner(command, **_kwargs):
            captured["command"] = command
            return _FakeCompletedProcess(
                '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"已整理業務重點\\",\\"key_points\\":[],\\"action_items\\":[],\\"decisions\\":[],\\"risks\\":[],\\"open_questions\\":[]}"}}'
            )

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.3-codex-spark",
            reasoning_effort="medium",
            runner=fake_runner,
        )

        summarizer.summarize(
            {
                "language": "zh",
                "segments": [
                    {"start_ms": 0, "end_ms": 1000, "text": "客戶詢問導入時程"}
                ],
            },
            summary_profile="sales",
            model_override="gpt-5.4-nano",
        )

        prompt = captured["command"][-1]
        self.assertIn("gpt-5.4-nano", captured["command"])
        self.assertIn("do not omit material discussion points", prompt.lower())
        self.assertIn("sales follow-up", prompt.lower())
        self.assertIn("customer concerns", prompt.lower())

    def test_raises_the_structured_codex_error_message_when_stdout_contains_it(self) -> None:
        def fake_runner(*_args, **_kwargs):
            return _FakeCompletedProcess(
                stdout="\n".join(
                    [
                        '{"type":"thread.started","thread_id":"abc"}',
                        '{"type":"turn.started"}',
                        '{"type":"error","message":"The configured model is unavailable."}',
                        '{"type":"turn.failed","error":{"message":"The configured model is unavailable."}}',
                    ]
                ),
                stderr="Reading additional input from stdin...",
                returncode=1,
            )

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.3-codex-spark",
            reasoning_effort="medium",
            runner=fake_runner,
        )

        with self.assertRaisesRegex(RuntimeError, "configured model is unavailable"):
            summarizer.summarize(
                {
                    "language": "zh",
                    "segments": [
                        {"start_ms": 0, "end_ms": 1000, "text": "測試摘要失敗"}
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
