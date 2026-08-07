from transcription_worker.heartbeat import start_lease_heartbeat
from threading import Lock


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
    if "cache_write_prompt_tokens" in usage:
        event["cacheWritePromptTokens"] = usage["cache_write_prompt_tokens"]
    return event


def _failed_summary_usage_event(error):
    usage = getattr(error, "usage", None)
    return _summary_usage_event(usage) if isinstance(usage, dict) else None


def _quota_is_exhausted(probe):
    if probe is None:
        return False
    try:
        return probe() is True
    except Exception:
        return False


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
    azure_fallback_summarizer=None,
    quota_is_exhausted=None,
    codex_usage=None,
    heartbeat_interval_ms=30_000,
):
    claimed_job = client.claim_next_summary_job(worker_id, codex_usage=codex_usage)

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
    actual_provider = "local-codex"
    provider_request_ids = []
    provider_request_ids_lock = Lock()

    def report_provider_request(update):
        request_id = update["requestId"]
        if update["action"] == "start":
            client.start_provider_request(
                claimed_job["id"],
                request_id,
                stage="summary",
                lease_token=claimed_job["leaseToken"],
                provider=update["provider"],
                model=update["model"],
                operation=update.get("operation"),
            )
            with provider_request_ids_lock:
                provider_request_ids.append(request_id)
            return

        client.finish_provider_request(
            claimed_job["id"],
            request_id,
            lease_token=claimed_job["leaseToken"],
            status=update["status"],
            provider_request_id=update.get("providerRequestId"),
            http_status=update.get("httpStatus"),
            error_code=update.get("errorCode"),
            usage=update.get("usage"),
        )

    def request_audit_ids():
        with provider_request_ids_lock:
            return list(provider_request_ids)

    try:
        transcript_artifact = claimed_job["transcriptArtifact"]
        transcript_result = {
            "language": transcript_artifact.get("language", "unknown"),
            "segments": [
                _summary_segment(segment)
                for segment in transcript_artifact.get("segments", [])
            ],
        }

        summary_options = {
            "summary_profile": claimed_job.get("summaryProfile", "general"),
            "model_override": claimed_job.get("summaryModel"),
        }

        if _quota_is_exhausted(quota_is_exhausted):
            if azure_fallback_summarizer is None:
                raise RuntimeError(
                    "Codex quota is exhausted and Azure summary fallback is not configured"
                )
            if not client.reserve_summary_fallback(
                claimed_job["id"], claimed_job.get("leaseToken")
            ):
                raise RuntimeError(
                    "Azure summary fallback was already attempted for this job"
                )
            actual_provider = "azure-openai"
            summary_result = azure_fallback_summarizer.summarize(
                transcript_result,
                on_provider_request=report_provider_request,
                **summary_options,
            )
        else:
            summary_result = summarizer.summarize(
                transcript_result,
                on_provider_request=report_provider_request,
                **summary_options,
            )
        summary_generated = True

        summary_event = {
            "type": "summary-artifact-stored",
            "actualProvider": actual_provider,
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
        if request_audit_ids():
            summary_event["requestAuditIds"] = request_audit_ids()
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

        audit_ids = request_audit_ids()
        failure_event = {
            "type": "summary-failed",
            "failure": {
                "code": "summary-failed",
                "message": str(error),
            },
        }
        if actual_provider != "azure-openai" or audit_ids:
            failure_event["actualProvider"] = actual_provider
        failed_usage = _failed_summary_usage_event(error)
        if failed_usage and audit_ids:
            failure_event["usage"] = failed_usage
        if audit_ids:
            failure_event["requestAuditIds"] = audit_ids
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
