def _post_progress(client, job_id: str, processing_stage: str, processing_message: str) -> None:
    client.post_job_event(
        job_id,
        {
            "type": "progress-updated",
            "processingStage": processing_stage,
            "processingMessage": processing_message,
        },
    )


class JobCancelledError(RuntimeError):
    pass


def run_transcription_worker_iteration(
    worker_id, client, downloader, media_preparer, transcriber, summarizer=None
):
    claimed_job = client.claim_next_job(worker_id)

    if not claimed_job:
        return {"kind": "idle"}

    try:
        recording_artifact = claimed_job["recordingArtifact"]
        _post_progress(
            client,
            claimed_job["id"],
            "preparing-media",
            "Downloading source media for transcription.",
        )
        local_media_path = downloader.download(recording_artifact)

        _post_progress(
            client,
            claimed_job["id"],
            "preparing-media",
            "Preparing canonical audio for transcription.",
        )
        prepared_audio = media_preparer.prepare(
            local_media_path,
            recording_artifact["contentType"],
        )

        _post_progress(
            client,
            claimed_job["id"],
            "transcribing-audio",
            "Running Whisper transcription.",
        )
        last_reported_percent = None

        def report_transcription_progress(update):
            nonlocal last_reported_percent

            percent = update["percent"]

            if last_reported_percent is not None and percent <= last_reported_percent:
                return

            last_reported_percent = percent
            client.post_job_event(
                claimed_job["id"],
                {
                    "type": "progress-updated",
                    "processingStage": "transcribing-audio",
                    "processingMessage": "Running Whisper transcription.",
                    "progressPercent": percent,
                    "progressProcessedMs": update["processed_ms"],
                    "progressTotalMs": update["total_ms"],
                },
            )

            latest_job = client.get_job(claimed_job["id"])
            if (
                latest_job
                and latest_job.get("state") == "failed"
                and latest_job.get("failureCode") == "operator-cancel-requested"
            ):
                raise JobCancelledError("job cancelled by operator")

        transcript_result = transcriber.transcribe(
            prepared_audio["local_audio_path"],
            on_progress=report_transcription_progress,
        )
    except JobCancelledError:
        return {"kind": "cancelled", "job_id": claimed_job["id"]}
    except Exception as error:
        client.post_job_event(
            claimed_job["id"],
            {
                "type": "transcription-failed",
                "failure": {
                    "code": "transcription-failed",
                    "message": str(error),
                },
            },
        )
        return {"kind": "failed", "job_id": claimed_job["id"]}

    client.post_job_event(
        claimed_job["id"],
        {
            "type": "transcript-artifact-stored",
            "transcriptArtifact": {
                "storageKey": f"transcripts/{claimed_job['id']}/transcript.json",
                "downloadUrl": f"{claimed_job['recordingArtifact']['downloadUrl']}.transcript.json",
                "contentType": "application/json",
                "language": transcript_result["language"],
                "segments": [
                    {
                        "startMs": segment["start_ms"],
                        "endMs": segment["end_ms"],
                        "text": segment["text"],
                    }
                    for segment in transcript_result["segments"]
                ],
            },
        },
    )

    if summarizer is not None:
        try:
            _post_progress(
                client,
                claimed_job["id"],
                "generating-summary",
                "Generating Codex summary.",
            )
            summary_result = summarizer.summarize(transcript_result)
            client.post_job_event(
                claimed_job["id"],
                {
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
                },
            )
        except Exception as error:
            print(f"summary generation failed for {claimed_job['id']}: {error}")

    return {"kind": "processed", "job_id": claimed_job["id"]}
