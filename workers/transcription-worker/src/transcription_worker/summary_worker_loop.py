from transcription_worker.heartbeat import start_lease_heartbeat


def _summary_usage_event(usage):
    event = {
        "promptTokens": usage["prompt_tokens"],
        "cachedPromptTokens": usage.get("cached_prompt_tokens", 0),
        "completionTokens": usage["completion_tokens"],
        "reasoningCompletionTokens": usage.get("reasoning_completion_tokens", 0),
        "totalTokens": usage["total_tokens"],
    }
    if "provider_request_count" in usage:
        event["providerRequestCount"] = usage["provider_request_count"]
    if "unmetered_request_count" in usage:
        event["unmeteredRequestCount"] = usage["unmetered_request_count"]
    return event


def _failed_summary_usage_event(error):
    usage = getattr(error, "usage", None)
    if not isinstance(usage, dict):
        return None

    event = {
        "promptTokens": usage["input_tokens"],
        "cachedPromptTokens": usage["cached_input_tokens"],
        "completionTokens": usage["output_tokens"],
        "reasoningCompletionTokens": usage["reasoning_output_tokens"],
        "totalTokens": usage["total_tokens"],
    }
    if "provider_request_count" in usage:
        event["providerRequestCount"] = usage["provider_request_count"]
    if "unmetered_request_count" in usage:
        event["unmeteredRequestCount"] = usage["unmetered_request_count"]
    return event


def _post_terminal_event(client, job_id, payload, lease_token):
    try:
        client.post_job_event(job_id, payload, lease_token=lease_token)
    except Exception:
        client.post_job_event(job_id, payload, lease_token=lease_token)


def _summary_review_flag(review_flag):
    result = {
        "reason": review_flag["reason"],
        "original_text": review_flag["originalText"],
        "candidates": review_flag.get("candidates", []),
    }
    for source_key, target_key in (
        ("startMs", "start_ms"),
        ("endMs", "end_ms"),
        ("evidence", "evidence"),
    ):
        if source_key in review_flag:
            result[target_key] = review_flag[source_key]
    return result


def _summary_segment(segment):
    result = {
        "start_ms": segment["startMs"],
        "end_ms": segment["endMs"],
        "text": segment.get("displayText") or segment["text"],
    }
    for source_key, target_key in (
        ("rawText", "raw_text"),
        ("displayText", "display_text"),
        ("language", "language"),
        ("languageConfidence", "language_confidence"),
        ("timingSource", "timing_source"),
        ("speaker", "speaker"),
    ):
        if source_key in segment:
            result[target_key] = segment[source_key]
    if segment.get("reviewFlags"):
        result["review_flags"] = [
            _summary_review_flag(review_flag)
            for review_flag in segment["reviewFlags"]
        ]
    return result


def run_summary_worker_iteration(
    worker_id,
    client,
    summarizer,
    summarizer_registry=None,
    heartbeat_interval_ms=30_000,
):
    claimed_job = client.claim_next_summary_job(worker_id)

    if not claimed_job:
        return {"kind": "idle"}

    heartbeat_stop, heartbeat_thread = start_lease_heartbeat(
        client,
        claimed_job["id"],
        "summary",
        claimed_job.get("leaseToken"),
        heartbeat_interval_ms,
    )

    summary_generated = False

    try:
        transcript_artifact = claimed_job["transcriptArtifact"]
        transcript_result = {
            "language": transcript_artifact.get("language", "unknown"),
            "segments": [
                _summary_segment(segment)
                for segment in transcript_artifact.get("segments", [])
            ],
        }

        selected_summarizer = (
            summarizer_registry.get(claimed_job.get("summaryProvider"))
            if claimed_job.get("summaryProvider") and summarizer_registry is not None
            else summarizer
        )

        summary_result = selected_summarizer.summarize(
            transcript_result,
            summary_profile=claimed_job.get("summaryProfile", "general"),
            model_override=claimed_job.get("summaryModel")
            if claimed_job.get("summaryProvider") == "azure-openai"
            else None,
        )
        summary_generated = True

        summary_event = {
            "type": "summary-artifact-stored",
            "summaryArtifact": {
                "model": summary_result["model"],
                "reasoningEffort": summary_result["reasoning_effort"],
                "text": summary_result["text"],
                "structured": {
                    **(
                        {"title": summary_result["structured"]["title"]}
                        if summary_result["structured"].get("title")
                        else {}
                    ),
                    "summary": summary_result["structured"]["summary"],
                    "topics": summary_result["structured"].get("topics", []),
                    "followUpGroups": summary_result["structured"].get(
                        "follow_up_groups", []
                    ),
                    "analysisNotes": summary_result["structured"].get(
                        "analysis_notes", []
                    ),
                    "keyPoints": summary_result["structured"]["key_points"],
                    "actionItems": summary_result["structured"]["action_items"],
                    "decisions": summary_result["structured"]["decisions"],
                    "risks": summary_result["structured"]["risks"],
                    "openQuestions": summary_result["structured"]["open_questions"],
                }
                if summary_result.get("structured")
                else None,
            },
        }
        if summary_result.get("usage"):
            summary_event["usage"] = _summary_usage_event(summary_result["usage"])
        _post_terminal_event(
            client,
            claimed_job["id"],
            summary_event,
            claimed_job.get("leaseToken"),
        )

        return {"kind": "processed", "job_id": claimed_job["id"]}
    except Exception as error:
        if summary_generated:
            raise

        failure_event = {
            "type": "summary-failed",
            "failure": {
                "code": "summary-failed",
                "message": str(error),
            },
        }
        failed_usage = _failed_summary_usage_event(error)
        if failed_usage:
            failure_event["usage"] = failed_usage
        _post_terminal_event(
            client,
            claimed_job["id"],
            failure_event,
            claimed_job.get("leaseToken"),
        )
        return {"kind": "failed", "job_id": claimed_job["id"]}
    finally:
        # Stop the lease heartbeat on EVERY exit path (success or failure),
        # including when the success-path event POST or transcript parsing raises,
        # so a daemon heartbeat can never keep renewing the lease for a summary job
        # we have stopped processing.
        if heartbeat_stop:
            heartbeat_stop.set()
        if heartbeat_thread:
            heartbeat_thread.join(timeout=1)
