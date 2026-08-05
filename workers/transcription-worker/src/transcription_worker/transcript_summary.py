import json
from typing import Any

_TOPIC_STATUSES = {"confirmed", "mixed", "open"}


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_grouped_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    groups: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        items = _normalize_string_list(item.get("items"))
        if title and items:
            groups.append({"title": title, "items": items})

    return groups


def _normalize_subtopics(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    subtopics: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        details = _normalize_string_list(item.get("details"))
        if title and details:
            subtopics.append({"title": title, "details": details})

    return subtopics


def _normalize_topics(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    topics: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        status = str(item.get("status", "")).strip()
        subtopics = _normalize_subtopics(item.get("subtopics"))
        points = [
            f"{subtopic['title']}：{detail}"
            for subtopic in subtopics
            for detail in subtopic["details"]
        ] or _normalize_string_list(item.get("points"))
        conclusion = str(item.get("conclusion", "")).strip()
        if title and status in _TOPIC_STATUSES and points and conclusion:
            topics.append(
                {
                    "title": title,
                    "status": status,
                    "subtopics": subtopics,
                    "points": points,
                    "conclusion": conclusion,
                }
            )

    return topics


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


def _format_segment_marker(index: int, start_ms: Any, end_ms: Any) -> str:
    def format_time(value: Any) -> str:
        total_seconds = max(0, int(value or 0) // 1000)
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    return f"[S{index:04d} {format_time(start_ms)}-{format_time(end_ms)}]"


def build_summary_prompt(
    transcript_result: dict[str, Any], summary_profile: str = "general"
) -> str:
    transcript_lines: list[str] = []
    for index, segment in enumerate(transcript_result.get("segments", []), start=1):
        display_text = str(segment.get("display_text") or segment.get("text", "")).strip()
        speaker = str(segment.get("speaker", "")).strip()
        for prefix in (f"{speaker}:", f"{speaker}：") if speaker else ():
            if display_text.startswith(prefix):
                display_text = display_text[len(prefix) :].strip()
                break
        marker = _format_segment_marker(
            index,
            segment.get("start_ms"),
            segment.get("end_ms"),
        )
        if display_text:
            transcript_lines.append(f"{marker} {display_text}")

        for review_flag in segment.get("review_flags", []):
            original_text = str(review_flag.get("original_text", "")).strip()
            candidates = _normalize_string_list(review_flag.get("candidates"))
            reason = str(review_flag.get("reason", "")).strip()
            if reason == "operator-verified-alias":
                continue
            transcript_lines.append(
                f"{marker} UNCONFIRMED review flag: "
                f'original="{original_text}", '
                f"candidates={json.dumps(candidates, ensure_ascii=False)}, "
                f'reason="{reason}"'
            )

    transcript_text = "\n".join(transcript_lines)

    return (
        "Turn this raw meeting transcript into a fluent, evidence-faithful meeting article.\n"
        "Return JSON only.\n"
        "Rules:\n"
        "- Stay faithful to the transcript.\n"
        "- Do not invent facts, decisions, risks, questions, owners, dates, or commitments.\n"
        "- Rewrite filler, repetition, interruptions, and fragmented speech as natural, professional, grammatically complete prose without changing the supported meaning or uncertainty.\n"
        "- Do not merely concatenate spoken fragments or reproduce dialogue order when a clearer logical explanation is supported.\n"
        "- Only include follow-up work when the transcript explicitly assigns or commits the action.\n"
        "- Only include a decision when the transcript explicitly reaches an agreement or final choice.\n"
        "- Keep tentative, contested, or later-to-be-confirmed points out of decisions and state them as open questions.\n"
        "- Do not treat questions as facts or turn workload/deadline discussion into a predicted schedule risk unless explicitly stated.\n"
        "- If a technical name or identifier is incoherent, contradictory, or cannot be confirmed from the transcript itself, use only the supported functional description without choosing or correcting a candidate term.\n"
        "- Do not invent generic follow-up work, even when it would normally be useful.\n"
        "- Do not resolve or accept a review candidate. Treat every UNCONFIRMED candidate as non-authoritative evidence.\n"
        "- Preserve explicitly and consistently established names, numbers, dates, units, and model identifiers verbatim.\n"
        "- Preserve foreign-language text and proper nouns; do not translate foreign-language literals.\n"
        "- Do not repeat the same fact across sections unless the transcript gives it distinct roles.\n"
        "- Prefer complete coverage over a shorter answer; keep each item concise and evidence based.\n"
        "- Before returning JSON, silently review the beginning, middle, and final third of the transcript so late discussion receives equal coverage.\n"
        "- Create a main topic only for an independent decision domain, operating process, deliverable, or scope boundary.\n"
        "- Keep related functions, screens, exceptions, examples, and implementation details as subtopics of that main topic instead of separate main topics.\n"
        "- Group repeated discussion of the same subject, while keeping materially different decisions, processes, deliverables, or scope boundaries distinguishable.\n"
        "- Let the transcript determine how many topics and subtopics exist; do not target, pad, minimize, or cap their count.\n"
        "- Derive specific topic titles from the transcript; never use generic titles such as Topic 1 or Other and never use a fixed meeting-specific topic list.\n"
        "- Within one decision domain, order supported subtopics by prerequisites, normal flow, exceptions or recovery, ownership, and outcome when those relationships exist; do not add absent stages.\n"
        "- Write supported details with the subject, action, condition, and result needed to preserve their relationship, without inventing any missing element.\n"
        "- When the transcript explicitly makes one topic depend on another, name that dependency in the dependent topic's details or conclusion; never infer a dependency from proximity alone.\n"
        "- Within each subtopic, order complete sentences by context, material detail, rationale or consequence, and outcome when those elements are supported; do not force unsupported detail types.\n"
        "- For every topic, use status confirmed only when its material conclusion is explicitly settled, mixed when settled and pending points coexist, and open when no final conclusion was reached.\n"
        "- Each topic conclusion must state the actual outcome and explicitly retain pending approval, implementation, evidence, or scope gaps.\n"
        "- A requirement or design conclusion is not automatically a follow-up. Add follow-up work only when the transcript explicitly requests or commits someone or some party to provide, confirm, modify, test, reply, or deliver something.\n"
        "- Group follow-up items that produce the same deliverable or depend on the same unresolved input; retain an owner and deadline only when explicitly stated.\n"
        "- Classify decisions as explicit final agreements only, risks as explicitly stated adverse impacts, blockers, or dependencies, and open_questions as unresolved choices, missing inputs, or pending approvals.\n"
        "- Use analysis_notes only for material evidence-backed gaps, contradictions, dependencies, or adverse impacts that help the reader understand execution risk; never invent a solution.\n"
        "- Merge follow-up groups that produce the same deliverable and merge analysis notes that share the same root cause.\n"
        "- A supported fact may appear in its topic and one classification section because those serve different reading purposes; otherwise avoid duplication.\n"
        "- Silently verify that every explicit follow-up, decision, risk, and open question found during the coverage review appears in its matching section.\n"
        "- Do not emit placeholders such as unknown, TBD, or [insert location], and do not create unsupported meeting-information fields.\n"
        "- Write title as a specific, content-derived meeting title and summary as a concise overview of the purpose, major outcomes, and most important pending matters.\n"
        f"{_build_profile_guidance(summary_profile)}"
        "- The JSON schema is: "
        '{"title": string, "summary": string, "topics": [{"title": string, "status": "confirmed" | "mixed" | "open", "subtopics": [{"title": string, "details": string[]}], "conclusion": string}], "follow_up_groups": [{"title": string, "items": string[]}], "decisions": string[], "risks": string[], "open_questions": string[], "analysis_notes": string[]}.\n'
        "- When the source is Chinese, use fluent Traditional Chinese (Taiwan) for content.\n"
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
        list_fields = ("decisions", "risks", "open_questions", "analysis_notes")
        if any(
            not isinstance(payload.get(field), str) or not payload[field].strip()
            for field in ("title", "summary")
        ):
            raise RuntimeError(f"{provider_label} returned invalid summary payload")
        if any(
            field not in payload
            or not isinstance(payload[field], list)
            or any(not isinstance(item, str) for item in payload[field])
            for field in list_fields
        ):
            raise RuntimeError(f"{provider_label} returned invalid summary payload")
        if not isinstance(payload.get("topics"), list) or any(
            not isinstance(topic, dict)
            or not isinstance(topic.get("title"), str)
            or not topic["title"].strip()
            or topic.get("status") not in _TOPIC_STATUSES
            or not isinstance(topic.get("subtopics"), list)
            or not topic["subtopics"]
            or any(
                not isinstance(subtopic, dict)
                or not isinstance(subtopic.get("title"), str)
                or not subtopic["title"].strip()
                or not isinstance(subtopic.get("details"), list)
                or not subtopic["details"]
                or any(
                    not isinstance(detail, str) or not detail.strip()
                    for detail in subtopic["details"]
                )
                for subtopic in topic["subtopics"]
            )
            or not isinstance(topic.get("conclusion"), str)
            or not topic["conclusion"].strip()
            for topic in payload.get("topics", [])
        ):
            raise RuntimeError(f"{provider_label} returned invalid summary payload")
        if not isinstance(payload.get("follow_up_groups"), list) or any(
            not isinstance(group, dict)
            or not isinstance(group.get("title"), str)
            or not group["title"].strip()
            or not isinstance(group.get("items"), list)
            or not group["items"]
            or any(not isinstance(item, str) or not item.strip() for item in group["items"])
            for group in payload.get("follow_up_groups", [])
        ):
            raise RuntimeError(f"{provider_label} returned invalid summary payload")

    topics = _normalize_topics(payload.get("topics"))
    follow_up_groups = _normalize_grouped_items(payload.get("follow_up_groups"))
    return {
        "title": str(payload.get("title", "")).strip(),
        "summary": str(payload.get("summary", "")).strip(),
        "topics": topics,
        "follow_up_groups": follow_up_groups,
        "analysis_notes": _normalize_string_list(payload.get("analysis_notes")),
        "key_points": [topic["conclusion"] for topic in topics],
        "action_items": [
            item for group in follow_up_groups for item in group["items"]
        ],
        "decisions": _normalize_string_list(payload.get("decisions")),
        "risks": _normalize_string_list(payload.get("risks")),
        "open_questions": _normalize_string_list(payload.get("open_questions")),
    }


def render_summary_markdown(summary_payload: dict[str, Any]) -> str:
    lines: list[str] = []
    status_labels = {
        "confirmed": "已確認",
        "mixed": "部分確認",
        "open": "待確認",
    }

    if summary_payload.get("title"):
        lines.extend([f"# {summary_payload['title']}", ""])

    if summary_payload["summary"]:
        lines.extend(["## 會議摘要", summary_payload["summary"], ""])

    topics = summary_payload.get("topics", [])
    if topics:
        lines.extend(["## 會議紀要", ""])
        for topic in topics:
            lines.append(f"### {topic['title']}")
            lines.append(f"**狀態：** {status_labels[topic['status']]}")
            if topic.get("subtopics"):
                for subtopic in topic["subtopics"]:
                    lines.append(f"#### {subtopic['title']}")
                    lines.extend(f"- {detail}" for detail in subtopic["details"])
            else:
                lines.extend(f"- {point}" for point in topic["points"])
            lines.append(f"**結論：** {topic['conclusion']}")
            lines.append("")

    follow_up_groups = summary_payload.get("follow_up_groups", [])
    if follow_up_groups:
        lines.extend(["## 後續安排", ""])
        for group in follow_up_groups:
            lines.append(f"### {group['title']}")
            lines.extend(f"- {item}" for item in group["items"])
            lines.append("")

    sections = [
        ("會議重點", [] if topics else summary_payload["key_points"]),
        ("後續安排", [] if follow_up_groups else summary_payload["action_items"]),
        ("已確認決議", summary_payload["decisions"]),
        ("風險與提醒", summary_payload["risks"]),
        ("待確認問題", summary_payload["open_questions"]),
        ("AI 分析", summary_payload.get("analysis_notes", [])),
    ]
    for heading, items in sections:
        if not items:
            continue
        lines.append(f"## {heading}")
        lines.extend(f"- {item}" for item in items)
        lines.append("")

    return "\n".join(lines).strip()
