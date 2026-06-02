from transcription_worker.heartbeat import start_lease_heartbeat


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

    try:
        transcript_artifact = claimed_job["transcriptArtifact"]
        transcript_result = {
            "language": transcript_artifact.get("language", "unknown"),
            "segments": [
                {
                    "start_ms": segment["startMs"],
                    "end_ms": segment["endMs"],
                    "text": segment["text"],
                }
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

        summary_event = {
            "type": "summary-artifact-stored",
            "summaryArtifact": {
                "model": summary_result["model"],
                "reasoningEffort": summary_result["reasoning_effort"],
                "text": summary_result["text"],
                "structured": {
                    "summary": summary_result["structured"]["summary"],
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
            summary_event["usage"] = {
                "promptTokens": summary_result["usage"]["prompt_tokens"],
                "completionTokens": summary_result["usage"]["completion_tokens"],
                "totalTokens": summary_result["usage"]["total_tokens"],
            }
        client.post_job_event(
            claimed_job["id"],
            summary_event,
            lease_token=claimed_job.get("leaseToken"),
        )

        return {"kind": "processed", "job_id": claimed_job["id"]}
    except Exception as error:
        client.post_job_event(
            claimed_job["id"],
            {
                "type": "summary-failed",
                "failure": {
                    "code": "summary-failed",
                    "message": str(error),
                },
            },
            lease_token=claimed_job.get("leaseToken"),
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
