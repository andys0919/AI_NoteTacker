import json
import subprocess
from typing import Any


def _build_summary_prompt(transcript_result: dict[str, Any]) -> str:
    transcript_text = "\n".join(
        segment["text"].strip()
        for segment in transcript_result.get("segments", [])
        if str(segment.get("text", "")).strip()
    )

    return (
        "You are summarizing a meeting transcript.\n"
        "Write concise Traditional Chinese Markdown.\n"
        "Rules:\n"
        "- Stay faithful to the transcript.\n"
        "- Do not invent facts.\n"
        "- Keep it scannable and practical.\n"
        "- Include these sections exactly: ## Summary, ## Key Points, ## Action Items, ## Open Questions\n"
        "- If a section has no content, write `None.`\n\n"
        f"Transcript:\n{transcript_text}"
    )


def _extract_summary_text(stdout_text: str) -> str:
    parts: list[str] = []

    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue

        event = json.loads(line)
        if event.get("type") != "item.completed":
            continue

        item = event.get("item") or {}
        if item.get("type") == "agent_message" and str(item.get("text", "")).strip():
            parts.append(str(item["text"]).strip())

    return "\n".join(parts).strip()


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

    def summarize(self, transcript_result: dict[str, Any]) -> dict[str, str]:
        prompt = _build_summary_prompt(transcript_result)
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
            self._model,
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
            stderr_text = (result.stderr or "").strip()
            raise RuntimeError(stderr_text or f"codex exited with status {result.returncode}")

        summary_text = _extract_summary_text(result.stdout or "")

        if not summary_text:
            raise RuntimeError("codex returned no summary text")

        return {
            "model": self._model,
            "reasoning_effort": self._reasoning_effort,
            "text": summary_text,
        }
