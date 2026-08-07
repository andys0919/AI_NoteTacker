import os
import json
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from transcription_worker.codex_transcript_summarizer import (
    CodexTranscriptSummarizer,
    _rate_limit_snapshot_is_exhausted,
    _run_codex_process,
    _terminate_process_group,
    codex_weekly_usage_from_rate_limits,
    is_codex_quota_exhausted,
)


class _FakeCompletedProcess:
    def __init__(self, stdout: str, stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


class CodexTranscriptSummarizerTests(unittest.TestCase):
    def test_returns_structured_summary_and_markdown_text(self) -> None:
        audit_updates = []

        def fake_runner(*_args, **_kwargs):
            return _FakeCompletedProcess(
                '\n'.join(
                    [
                        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\":\\"產品上線規劃\\",\\"summary\\":\\"討論產品上線時程。\\",\\"topics\\":[{\\"title\\":\\"上線規劃\\",\\"status\\":\\"mixed\\",\\"subtopics\\":[{\\"title\\":\\"發布準備\\",\\"details\\":[\\"需要完成 QA\\"]}],\\"conclusion\\":\\"先上 beta，對外公告負責人待確認。\\"}],\\"follow_up_groups\\":[{\\"title\\":\\"發布作業\\",\\"items\\":[\\"Andy 更新發布清單\\"]}],\\"decisions\\":[\\"先上 beta\\"],\\"risks\\":[\\"時程壓縮\\"],\\"open_questions\\":[\\"誰負責對外公告？\\"],\\"analysis_notes\\":[]}"}}',
                        '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":300}}'
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
            },
            on_provider_request=audit_updates.append,
        )

        self.assertEqual(result["structured"]["action_items"], ["Andy 更新發布清單"])
        self.assertEqual(result["structured"]["decisions"], ["先上 beta"])
        self.assertEqual(result["structured"]["risks"], ["時程壓縮"])
        self.assertIn("## 已確認決議", result["text"])
        self.assertIn("## 風險與提醒", result["text"])
        self.assertEqual(
            [update["action"] for update in audit_updates], ["start", "finish"]
        )
        self.assertEqual(audit_updates[0]["provider"], "local-codex")
        self.assertEqual(
            audit_updates[1]["usage"],
            {
                "inputTokens": 1000,
                "cachedInputTokens": 200,
                "outputTokens": 300,
                "reasoningOutputTokens": 0,
                "totalTokens": 1300,
            },
        )

    def test_applies_summary_profile_guidance_to_the_prompt(self) -> None:
        captured = {}

        def fake_runner(command, **kwargs):
            captured["command"] = command
            captured["kwargs"] = kwargs
            captured["cwd_exists"] = Path(kwargs["cwd"]).is_dir()
            return _FakeCompletedProcess(
                '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"title\\":\\"客戶導入討論\\",\\"summary\\":\\"已整理業務重點\\",\\"topics\\":[{\\"title\\":\\"客戶需求\\",\\"status\\":\\"open\\",\\"subtopics\\":[{\\"title\\":\\"導入時程\\",\\"details\\":[\\"客戶詢問導入時程\\"]}],\\"conclusion\\":\\"導入時程尚待確認。\\"}],\\"follow_up_groups\\":[],\\"decisions\\":[],\\"risks\\":[],\\"open_questions\\":[],\\"analysis_notes\\":[]}"}}'
            )

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.3-codex-spark",
            reasoning_effort="medium",
            runner=fake_runner,
        )

        with patch.dict(
            os.environ,
            {
                "CODEX_HOME": "/codex-home",
                "INTERNAL_SERVICE_TOKEN": "test-only-internal-token",
                "AZURE_OPENAI_SUMMARY_API_KEY": "test-only-retired-key",
            },
        ):
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

        prompt = captured["kwargs"]["input"]
        self.assertIn("gpt-5.4-nano", captured["command"])
        self.assertEqual(captured["command"][-1], "-")
        self.assertIn("--ignore-user-config", captured["command"])
        self.assertIn("--ignore-rules", captured["command"])
        self.assertEqual(
            [
                captured["command"][index + 1]
                for index, value in enumerate(captured["command"])
                if value == "--disable"
            ],
            ["shell_tool", "unified_exec", "code_mode_host"],
        )
        self.assertTrue(captured["cwd_exists"])
        self.assertFalse(Path(captured["kwargs"]["cwd"]).exists())
        self.assertEqual(captured["kwargs"]["env"]["CODEX_HOME"], "/codex-home")
        self.assertNotIn("INTERNAL_SERVICE_TOKEN", captured["kwargs"]["env"])
        self.assertNotIn("AZURE_OPENAI_SUMMARY_API_KEY", captured["kwargs"]["env"])
        self.assertEqual(captured["kwargs"]["timeout"], 900)
        self.assertIn("untrusted meeting content", prompt.lower())
        self.assertIn("begin_untrusted_transcript", prompt.lower())
        self.assertIn("prefer complete coverage over a shorter answer", prompt.lower())
        self.assertIn("beginning, middle, and final third", prompt.lower())
        self.assertIn("sales follow-up", prompt.lower())
        self.assertIn("customer concerns", prompt.lower())

    def test_rejects_new_summary_without_topic_schema(self) -> None:
        audit_updates = []

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
                },
                on_provider_request=audit_updates.append,
            )

        self.assertEqual([update["action"] for update in audit_updates], ["start", "finish"])
        self.assertEqual(audit_updates[-1]["status"], "failed")
        self.assertEqual(audit_updates[-1]["errorCode"], "response-validation-failed")

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

    def test_applies_the_configured_wall_clock_timeout(self) -> None:
        captured = {}

        def fake_runner(*_args, **kwargs):
            captured["timeout"] = kwargs["timeout"]
            raise subprocess.TimeoutExpired("codex", kwargs["timeout"])

        summarizer = CodexTranscriptSummarizer(
            model="gpt-5.6-luna",
            reasoning_effort="max",
            timeout_seconds=17,
            runner=fake_runner,
        )

        with self.assertRaises(subprocess.TimeoutExpired):
            summarizer.summarize(
                {
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 1000, "text": "逾時測試"}],
                }
            )

        self.assertEqual(captured["timeout"], 17)

    def test_quota_classifier_requires_the_structured_reached_type(self) -> None:
        self.assertFalse(
            _rate_limit_snapshot_is_exhausted(
                {
                    "rateLimits": {
                        "primary": {"usedPercent": 100},
                        "rateLimitReachedType": None,
                    }
                }
            )
        )
        self.assertTrue(
            _rate_limit_snapshot_is_exhausted(
                {
                    "rateLimits": {
                        "rateLimitReachedType": "workspace_member_credits_depleted"
                    },
                    "rateLimitsByLimitId": {
                        "unrelated": {"rateLimitReachedType": None}
                    },
                }
            )
        )
        self.assertFalse(
            _rate_limit_snapshot_is_exhausted(
                {
                    "rateLimits": {"rateLimitReachedType": None},
                    "rateLimitsByLimitId": {
                        "unrelated": {"rateLimitReachedType": "rate_limit_reached"}
                    },
                }
            )
        )

    def test_reads_structured_quota_without_forwarding_worker_credentials(self) -> None:
        with TemporaryDirectory(prefix="codex-quota-test-") as directory:
            executable = Path(directory, "fake-codex")
            captured_environment = Path(directory, "environment.json")
            executable.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, select, sys\n"
                f"open({str(captured_environment)!r}, 'w').write(json.dumps({{"
                "'internal': 'INTERNAL_SERVICE_TOKEN' in os.environ, "
                "'azure': 'AZURE_OPENAI_SUMMARY_API_KEY' in os.environ}))\n"
                "def read_message():\n"
                "    data = b''\n"
                "    while not data.endswith(b'\\n'):\n"
                "        chunk = os.read(sys.stdin.fileno(), 1)\n"
                "        if not chunk:\n"
                "            raise SystemExit(6)\n"
                "        data += chunk\n"
                "    return json.loads(data)\n"
                "initialize = read_message()\n"
                "if initialize.get('id') != 1:\n"
                "    raise SystemExit(2)\n"
                "if select.select([sys.stdin.fileno()], [], [], 0.15)[0]:\n"
                "    raise SystemExit(3)\n"
                "print(json.dumps({'id': 1, 'result': {}}), flush=True)\n"
                "initialized = read_message()\n"
                "if initialized != {'method': 'initialized'}:\n"
                "    raise SystemExit(4)\n"
                "rate_request = read_message()\n"
                "if rate_request.get('id') != 2:\n"
                "    raise SystemExit(5)\n"
                "print(json.dumps({'id': 2, 'result': {'rateLimits': "
                "{'rateLimitReachedType': 'rate_limit_reached'}}}), flush=True)\n"
            )
            executable.chmod(0o700)

            with patch.dict(
                os.environ,
                {
                    "INTERNAL_SERVICE_TOKEN": "test-only-internal-token",
                    "AZURE_OPENAI_SUMMARY_API_KEY": "test-only-azure-key",
                },
            ):
                exhausted = is_codex_quota_exhausted(
                    str(executable), timeout_seconds=2
                )

            self.assertTrue(exhausted)
            self.assertEqual(
                json.loads(captured_environment.read_text()),
                {"internal": False, "azure": False},
            )

    def test_projects_only_the_seven_day_codex_usage_window(self) -> None:
        payload = {
            "rateLimits": {
                "primary": {
                    "usedPercent": 99,
                    "windowDurationMins": 300,
                    "resetsAt": 1_786_000_000,
                }
            },
            "rateLimitsByLimitId": {
                "codex": {
                    "planType": "team",
                    "primary": {
                        "usedPercent": 10,
                        "windowDurationMins": 300,
                        "resetsAt": 1_786_000_000,
                    },
                    "secondary": {
                        "usedPercent": 37.5,
                        "windowDurationMins": 10_080,
                        "resetsAt": 1_786_680_000,
                    },
                }
            },
        }

        self.assertEqual(
            codex_weekly_usage_from_rate_limits(
                payload, checked_at="2026-08-07T04:00:00+00:00"
            ),
            {
                "status": "available",
                "planType": "team",
                "usedPercent": 37.5,
                "windowDurationMins": 10_080,
                "resetsAt": 1_786_680_000,
                "checkedAt": "2026-08-07T04:00:00+00:00",
            },
        )
        self.assertEqual(
            codex_weekly_usage_from_rate_limits(
                {"rateLimits": payload["rateLimits"]},
                checked_at="2026-08-07T04:00:00+00:00",
            )["status"],
            "unavailable",
        )

    def test_timeout_terminates_the_codex_process_group(self) -> None:
        with TemporaryDirectory(prefix="codex-timeout-test-") as directory:
            child_pid_path = Path(directory, "child.pid")
            script = (
                "import subprocess, sys, time; "
                "from pathlib import Path; "
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import time; time.sleep(60)']); "
                "Path(sys.argv[1]).write_text(str(child.pid)); "
                "time.sleep(60)"
            )

            with self.assertRaisesRegex(RuntimeError, "codex timed out after"):
                _run_codex_process(
                    [sys.executable, "-c", script, str(child_pid_path)],
                    prompt="",
                    environment={},
                    working_directory=directory,
                    timeout_seconds=1,
                    terminate_grace_seconds=0.05,
                )

            child_pid = int(child_pid_path.read_text())
            child_running = True
            for _ in range(50):
                try:
                    state = Path(f"/proc/{child_pid}/stat").read_text().split()[2]
                    child_running = state != "Z"
                except FileNotFoundError:
                    child_running = False
                if not child_running:
                    break
                time.sleep(0.02)

            if child_running:
                os.kill(child_pid, signal.SIGKILL)
            self.assertFalse(child_running)

    def test_timeout_kills_a_pipe_holding_child_after_its_parent_exits(self) -> None:
        with TemporaryDirectory(prefix="codex-orphan-timeout-test-") as directory:
            child_pid_path = Path(directory, "child.pid")
            script = (
                "import subprocess, sys; "
                "from pathlib import Path; "
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import time; time.sleep(60)']); "
                "Path(sys.argv[1]).write_text(str(child.pid))"
            )

            with self.assertRaisesRegex(RuntimeError, "codex timed out after"):
                _run_codex_process(
                    [sys.executable, "-c", script, str(child_pid_path)],
                    prompt="",
                    environment={},
                    working_directory=directory,
                    timeout_seconds=0.2,
                    terminate_grace_seconds=0.05,
                )

            child_pid = int(child_pid_path.read_text())
            try:
                state = Path(f"/proc/{child_pid}/stat").read_text().split()[2]
                child_running = state != "Z"
            except FileNotFoundError:
                child_running = False

            if child_running:
                os.kill(child_pid, signal.SIGKILL)
            self.assertFalse(child_running)

    def test_process_group_termination_returns_promptly_after_clean_exit(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-c", "pass"],
            text=True,
            start_new_session=True,
        )
        process.wait()

        started_at = time.monotonic()
        _terminate_process_group(process, terminate_grace_seconds=1)

        self.assertLess(time.monotonic() - started_at, 0.2)


if __name__ == "__main__":
    unittest.main()
