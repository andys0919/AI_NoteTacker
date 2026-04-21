import json
import subprocess
from typing import Any


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    return [str(item).strip() for item in value if str(item).strip()]


def _build_profile_guidance(summary_profile: str) -> str:
    profile = (summary_profile or "general").strip().lower()

    if profile == "sales":
        return (
            "Treat this as a sales follow-up.\n"
            "- Focus extra attention on customer concerns, buying signals, blockers, next steps, and promised follow-up.\n"
        )

    if profile == "product":
        return (
            "Treat this as a product decision discussion.\n"
            "- Focus extra attention on requirements, trade-offs, owners, deadlines, and unresolved product questions.\n"
        )

    if profile == "hr":
        return (
            "Treat this as an HR or people conversation.\n"
            "- Focus extra attention on people decisions, action owners, sensitive risks, and follow-up commitments.\n"
        )

    return (
        "Treat this as a general internal meeting.\n"
        "- Focus on the clearest summary, actionable work, decisions, risks, and open questions.\n"
    )


def _build_summary_prompt(transcript_result: dict[str, Any], summary_profile: str = "general") -> str:
    transcript_text = "\n".join(
        segment["text"].strip()
        for segment in transcript_result.get("segments", [])
        if str(segment.get("text", "")).strip()
    )

    return (
        "You are summarizing a meeting transcript.\n"
        "Return JSON only.\n"
        "Rules:\n"
        "- Stay faithful to the transcript.\n"
        "- Do not invent facts.\n"
        "- Keep it scannable and practical.\n"
        "- Produce a detailed summary and do not omit material discussion points, decisions, blockers, rationale, or follow-up items.\n"
        f"{_build_profile_guidance(summary_profile)}"
        "- The JSON schema is: "
        '{"summary": string, "key_points": string[], "action_items": string[], "decisions": string[], "risks": string[], "open_questions": string[]}.\n'
        "- Use concise Traditional Chinese for content.\n"
        "- Use empty arrays when a section has no items.\n\n"
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


def _coerce_summary_payload(summary_text: str) -> dict[str, Any]:
    normalized = summary_text.strip()

    if normalized.startswith("```"):
        lines = normalized.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            normalized = "\n".join(lines[1:-1]).strip()
            if normalized.lower().startswith("json"):
                normalized = normalized[4:].strip()

    try:
        payload = json.loads(normalized)
    except json.JSONDecodeError:
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError("codex returned non-JSON summary output")
        payload = json.loads(normalized[start : end + 1])

    if not isinstance(payload, dict):
        raise RuntimeError("codex returned invalid summary payload")

    return {
        "summary": str(payload.get("summary", "")).strip(),
        "key_points": _normalize_string_list(payload.get("key_points")),
        "action_items": _normalize_string_list(payload.get("action_items")),
        "decisions": _normalize_string_list(payload.get("decisions")),
        "risks": _normalize_string_list(payload.get("risks")),
        "open_questions": _normalize_string_list(payload.get("open_questions")),
    }


def _render_summary_markdown(summary_payload: dict[str, Any]) -> str:
    sections = [
        ("Summary", [summary_payload["summary"]] if summary_payload["summary"] else ["None."]),
        ("Key Points", summary_payload["key_points"] or ["None."]),
        ("Action Items", summary_payload["action_items"] or ["None."]),
        ("Decisions", summary_payload["decisions"] or ["None."]),
        ("Risks", summary_payload["risks"] or ["None."]),
        ("Open Questions", summary_payload["open_questions"] or ["None."]),
    ]

    lines: list[str] = []

    for heading, items in sections:
        lines.append(f"## {heading}")
        for item in items:
            if item == "None.":
                lines.append("None.")
            else:
                lines.append(f"- {item}")
        lines.append("")

    return "\n".join(lines).strip()


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
        prompt = _build_summary_prompt(transcript_result, summary_profile=summary_profile)
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

        summary_payload = _coerce_summary_payload(summary_text)

        return {
            "model": model,
            "reasoning_effort": self._reasoning_effort,
            "text": _render_summary_markdown(summary_payload),
            "structured": {
                "summary": summary_payload["summary"],
                "key_points": summary_payload["key_points"],
                "action_items": summary_payload["action_items"],
                "decisions": summary_payload["decisions"],
                "risks": summary_payload["risks"],
                "open_questions": summary_payload["open_questions"],
            },
        }
