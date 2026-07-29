import json
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


def build_summary_prompt(
    transcript_result: dict[str, Any], summary_profile: str = "general"
) -> str:
    transcript_lines: list[str] = []
    for segment in transcript_result.get("segments", []):
        display_text = str(segment.get("display_text") or segment.get("text", "")).strip()
        if display_text:
            speaker = str(segment.get("speaker", "")).strip()
            transcript_lines.append(f"{speaker}: {display_text}" if speaker else display_text)

        for review_flag in segment.get("review_flags", []):
            original_text = str(review_flag.get("original_text", "")).strip()
            candidates = _normalize_string_list(review_flag.get("candidates"))
            reason = str(review_flag.get("reason", "")).strip()
            if reason == "operator-verified-alias":
                continue
            transcript_lines.append(
                "UNCONFIRMED review flag: "
                f'original="{original_text}", '
                f"candidates={json.dumps(candidates, ensure_ascii=False)}, "
                f'reason="{reason}"'
            )

    transcript_text = "\n".join(transcript_lines)

    return (
        "You are summarizing a meeting transcript.\n"
        "Return JSON only.\n"
        "Rules:\n"
        "- Stay faithful to the transcript.\n"
        "- Do not invent facts, decisions, risks, questions, owners, dates, or commitments.\n"
        "- Only include an action item when the transcript explicitly assigns or commits the action.\n"
        "- Only include a decision when the transcript explicitly reaches an agreement or final choice.\n"
        "- Keep tentative, contested, or later-to-be-confirmed points out of decisions and state them as open questions.\n"
        "- Do not treat questions as facts or turn workload/deadline discussion into a predicted schedule risk unless explicitly stated.\n"
        "- If a technical identifier is ambiguous or questioned, describe only the supported function without guessing the identifier.\n"
        "- Do not invent generic follow-up work, even when it would normally be useful.\n"
        "- Do not resolve or accept a review candidate. Treat every UNCONFIRMED candidate as non-authoritative evidence.\n"
        "- Preserve explicitly established names, numbers, dates, units, and model identifiers verbatim.\n"
        "- Treat Speaker labels as anonymous evidence; do not infer a person's real identity from them.\n"
        "- Preserve foreign-language text and proper nouns; do not translate foreign-language literals.\n"
        "- Do not repeat the same fact across sections unless the transcript gives it distinct roles.\n"
        "- Keep it scannable and practical.\n"
        "- Do not omit material discussion points, but include them only when supported directly by transcript evidence.\n"
        f"{_build_profile_guidance(summary_profile)}"
        "- The JSON schema is: "
        '{"summary": string, "key_points": string[], "action_items": string[], "decisions": string[], "risks": string[], "open_questions": string[]}.\n'
        "- Use concise Traditional Chinese for content.\n"
        "- Use an empty array when a section has no explicitly supported items.\n\n"
        f"Transcript:\n{transcript_text}"
    )


def coerce_summary_payload(
    summary_text: str,
    provider_label: str,
    require_complete_schema: bool = False,
) -> dict[str, Any]:
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
            raise RuntimeError(f"{provider_label} returned non-JSON summary output")
        payload = json.loads(normalized[start : end + 1])

    if not isinstance(payload, dict):
        raise RuntimeError(f"{provider_label} returned invalid summary payload")

    if require_complete_schema:
        list_fields = (
            "key_points",
            "action_items",
            "decisions",
            "risks",
            "open_questions",
        )
        if not isinstance(payload.get("summary"), str) or not payload["summary"].strip():
            raise RuntimeError(f"{provider_label} returned invalid summary payload")
        if any(
            field not in payload
            or not isinstance(payload[field], list)
            or any(not isinstance(item, str) for item in payload[field])
            for field in list_fields
        ):
            raise RuntimeError(f"{provider_label} returned invalid summary payload")

    return {
        "summary": str(payload.get("summary", "")).strip(),
        "key_points": _normalize_string_list(payload.get("key_points")),
        "action_items": _normalize_string_list(payload.get("action_items")),
        "decisions": _normalize_string_list(payload.get("decisions")),
        "risks": _normalize_string_list(payload.get("risks")),
        "open_questions": _normalize_string_list(payload.get("open_questions")),
    }


def render_summary_markdown(summary_payload: dict[str, Any]) -> str:
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
