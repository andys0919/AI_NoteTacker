import json
import subprocess
from typing import Any

from transcription_worker.transcript_summary import (
    build_summary_prompt,
    coerce_summary_payload,
    render_summary_markdown,
)


def _extract_summary_text(stdout_text: str) -> str:
    parts: list[str] = []

    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Codex may emit non-JSON lines that happen to start with '{'; skip them
            # instead of crashing the whole summarization job.
            continue
        if event.get("type") != "item.completed":
            continue

        item = event.get("item") or {}
        if item.get("type") == "agent_message" and str(item.get("text", "")).strip():
            parts.append(str(item["text"]).strip())

    return "\n".join(parts).strip()


def _extract_codex_error_message(stdout_text: str) -> str | None:
    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "error" and str(event.get("message", "")).strip():
            return str(event["message"]).strip()

        turn_error = event.get("error")
        if isinstance(turn_error, dict) and str(turn_error.get("message", "")).strip():
            return str(turn_error["message"]).strip()

    return None


class CodexTranscriptSummarizer:
    def __init__(
        self,
        model: str,
        reasoning_effort: str,
        codex_cli_path: str = "codex",
        runner=None,
    ) -> None:
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._codex_cli_path = codex_cli_path
        self._runner = runner or subprocess.run

    def summarize(
        self,
        transcript_result: dict[str, Any],
        summary_profile: str = "general",
        model_override: str | None = None,
    ) -> dict[str, Any]:
        prompt = build_summary_prompt(transcript_result, summary_profile=summary_profile)
        model = model_override or self._model
        command = [
            self._codex_cli_path,
            "exec",
            "--json",
            "--color",
            "never",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--model",
            model,
            "-c",
            f"model_reasoning_effort={self._reasoning_effort}",
            "--",
            prompt,
        ]
        result = self._runner(
            command,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            stdout_error = _extract_codex_error_message(result.stdout or "")
            if stdout_error:
                raise RuntimeError(stdout_error)

            stderr_text = (result.stderr or "").strip()
            raise RuntimeError(stderr_text or f"codex exited with status {result.returncode}")

        summary_text = _extract_summary_text(result.stdout or "")

        if not summary_text:
            raise RuntimeError("codex returned no summary text")

        summary_payload = coerce_summary_payload(
            summary_text,
            provider_label="codex",
            require_complete_schema=True,
        )

        return {
            "model": model,
            "reasoning_effort": self._reasoning_effort,
            "text": render_summary_markdown(summary_payload),
            "structured": {
                "title": summary_payload["title"],
                "summary": summary_payload["summary"],
                "topics": summary_payload["topics"],
                "follow_up_groups": summary_payload["follow_up_groups"],
                "analysis_notes": summary_payload["analysis_notes"],
                "key_points": summary_payload["key_points"],
                "action_items": summary_payload["action_items"],
                "decisions": summary_payload["decisions"],
                "risks": summary_payload["risks"],
                "open_questions": summary_payload["open_questions"],
            },
        }
