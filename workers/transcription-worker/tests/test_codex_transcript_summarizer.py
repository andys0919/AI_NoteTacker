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
                        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\":\\"產品上線規劃\\",\\"summary\\":\\"討論產品上線時程。\\",\\"topics\\":[{\\"title\\":\\"上線規劃\\",\\"status\\":\\"mixed\\",\\"subtopics\\":[{\\"title\\":\\"發布準備\\",\\"details\\":[\\"需要完成 QA\\"]}],\\"conclusion\\":\\"先上 beta，對外公告負責人待確認。\\"}],\\"follow_up_groups\\":[{\\"title\\":\\"發布作業\\",\\"items\\":[\\"Andy 更新發布清單\\"]}],\\"decisions\\":[\\"先上 beta\\"],\\"risks\\":[\\"時程壓縮\\"],\\"open_questions\\":[\\"誰負責對外公告？\\"],\\"analysis_notes\\":[]}"}}'
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
        self.assertIn("## 已確認決議", result["text"])
        self.assertIn("## 風險與提醒", result["text"])

    def test_applies_summary_profile_guidance_to_the_prompt(self) -> None:
        captured = {}

        def fake_runner(command, **_kwargs):
            captured["command"] = command
            return _FakeCompletedProcess(
                '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\":\\"客戶導入討論\\",\\"summary\\":\\"已整理業務重點\\",\\"topics\\":[{\\"title\\":\\"客戶需求\\",\\"status\\":\\"open\\",\\"subtopics\\":[{\\"title\\":\\"導入時程\\",\\"details\\":[\\"客戶詢問導入時程\\"]}],\\"conclusion\\":\\"導入時程尚待確認。\\"}],\\"follow_up_groups\\":[],\\"decisions\\":[],\\"risks\\":[],\\"open_questions\\":[],\\"analysis_notes\\":[]}"}}'
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
        self.assertIn("prefer complete coverage over a shorter answer", prompt.lower())
        self.assertIn("beginning, middle, and final third", prompt.lower())
        self.assertIn("sales follow-up", prompt.lower())
        self.assertIn("customer concerns", prompt.lower())

    def test_rejects_new_summary_without_topic_schema(self) -> None:
        def fake_runner(*_args, **_kwargs):
            return _FakeCompletedProcess(
                '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"缺少主題。\\",\\"key_points\\":[],\\"action_items\\":[],\\"decisions\\":[],\\"risks\\":[],\\"open_questions\\":[]}"}}'
            )

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.3-codex-spark",
            reasoning_effort="medium",
            runner=fake_runner,
        )

        with self.assertRaisesRegex(RuntimeError, "invalid summary payload"):
            summarizer.summarize(
                {
                    "language": "zh",
                    "segments": [
                        {"start_ms": 0, "end_ms": 1000, "text": "測試摘要 schema"}
                    ],
                }
            )

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
