from typing import Any


def _edit_distance(reference: list[str], candidate: list[str]) -> int:
    previous = list(range(len(candidate) + 1))
    for reference_index, reference_item in enumerate(reference, start=1):
        current = [reference_index]
        for candidate_index, candidate_item in enumerate(candidate, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[candidate_index] + 1,
                    previous[candidate_index - 1]
                    + (reference_item != candidate_item),
                )
            )
        previous = current
    return previous[-1]


def _rate(matches: int, total: int) -> float | None:
    return round(matches / total, 6) if total else None


def _precision_recall(reference: list[str], candidate: list[str]) -> tuple[float, float]:
    reference_set = set(reference)
    candidate_set = set(candidate)
    matches = len(reference_set & candidate_set)
    precision = matches / len(candidate_set) if candidate_set else float(not reference_set)
    recall = matches / len(reference_set) if reference_set else float(not candidate_set)
    return round(precision, 6), round(recall, 6)


def _contains_literal(text: str, literal: str) -> bool:
    start = text.find(literal)
    while start >= 0:
        end = start + len(literal)
        left_matches = start == 0 or not (
            literal[0].isalnum() and text[start - 1].isalnum()
        )
        right_matches = end == len(text) or not (
            literal[-1].isalnum() and text[end].isalnum()
        )
        if left_matches and right_matches:
            return True
        start = text.find(literal, start + 1)
    return False


def evaluate_benchmark(
    manifest: dict[str, Any], results: dict[str, Any]
) -> dict[str, Any]:
    if manifest.get("schemaVersion") != 1 or results.get("schemaVersion") != 1:
        raise ValueError("schemaVersion must be 1")
    if manifest.get("corpusVersion") != results.get("corpusVersion"):
        raise ValueError("results corpusVersion must match the manifest")

    result_by_id = {item["id"]: item for item in results.get("cases", [])}
    reference_character_count = 0
    character_errors = 0
    reference_word_count = 0
    word_errors = 0
    span_total = span_matches = 0
    traditional_total = traditional_matches = 0
    entity_total = entity_matches = 0
    numeric_total = numeric_matches = 0
    unsupported_summary_claim_count = 0
    reference_actions: list[str] = []
    candidate_actions: list[str] = []
    reference_decisions: list[str] = []
    candidate_decisions: list[str] = []
    latencies: list[float] = []
    usage: dict[str, int] = {}

    for case in manifest.get("cases", []):
        case_id = case["id"]
        if case_id not in result_by_id:
            raise ValueError(f"missing benchmark result for case: {case_id}")
        candidate = result_by_id[case_id]
        reference = case["reference"]
        reference_raw = str(reference.get("rawText", ""))
        candidate_raw = str(candidate.get("rawText", ""))
        candidate_display = str(candidate.get("displayText", candidate_raw))

        if case.get("scoringUnit") == "character":
            reference_units = [character for character in reference_raw if not character.isspace()]
            candidate_units = [character for character in candidate_raw if not character.isspace()]
            reference_character_count += len(reference_units)
            character_errors += _edit_distance(reference_units, candidate_units)
        elif case.get("scoringUnit") == "word":
            reference_units = reference_raw.casefold().split()
            candidate_units = candidate_raw.casefold().split()
            reference_word_count += len(reference_units)
            word_errors += _edit_distance(reference_units, candidate_units)

        for span in reference.get("languageSpans", []):
            span_total += 1
            span_matches += _contains_literal(candidate_raw, span)
        for span in reference.get("traditionalSpans", []):
            traditional_total += 1
            traditional_matches += _contains_literal(candidate_display, span)
        for entity in reference.get("domainEntities", []):
            entity_total += 1
            entity_matches += _contains_literal(candidate_display, entity)
        for numeric in reference.get("numerics", []):
            numeric_total += 1
            numeric_matches += _contains_literal(candidate_display, numeric)

        supported_claims = set(reference.get("summaryClaims", []))
        unsupported_summary_claim_count += sum(
            claim not in supported_claims for claim in candidate.get("summaryClaims", [])
        )
        reference_actions.extend(reference.get("actionItems", []))
        candidate_actions.extend(candidate.get("actionItems", []))
        reference_decisions.extend(reference.get("decisions", []))
        candidate_decisions.extend(candidate.get("decisions", []))

        if isinstance(candidate.get("latencyMs"), (int, float)):
            latencies.append(float(candidate["latencyMs"]))
        for key, value in candidate.get("usage", {}).items():
            if isinstance(value, int):
                usage[key] = usage.get(key, 0) + value

    action_precision, action_recall = _precision_recall(
        reference_actions, candidate_actions
    )
    decision_precision, decision_recall = _precision_recall(
        reference_decisions, candidate_decisions
    )

    return {
        "schemaVersion": 1,
        "corpusVersion": manifest["corpusVersion"],
        "provider": results.get("provider"),
        "model": results.get("model"),
        "caseCount": len(manifest.get("cases", [])),
        "characterErrorRate": _rate(character_errors, reference_character_count),
        "wordErrorRate": _rate(word_errors, reference_word_count),
        "languagePreservationRate": _rate(span_matches, span_total),
        "traditionalNormalizationAccuracy": _rate(
            traditional_matches, traditional_total
        ),
        "domainEntityAccuracy": _rate(entity_matches, entity_total),
        "numericAccuracy": _rate(numeric_matches, numeric_total),
        "unsupportedSummaryClaimCount": unsupported_summary_claim_count,
        "actionItemPrecision": action_precision,
        "actionItemRecall": action_recall,
        "decisionPrecision": decision_precision,
        "decisionRecall": decision_recall,
        "averageLatencyMs": round(sum(latencies) / len(latencies), 3)
        if latencies
        else None,
        "usage": dict(sorted(usage.items())),
    }
