from meeting_ai_pipeline.pipeline import run_meeting_ai_pipeline


def run_transcription_worker_iteration(worker_id, client, downloader, transcriber, summarizer=None):
    claimed_job = client.claim_next_job(worker_id)

    if not claimed_job:
        return {"kind": "idle"}

    try:
        pipeline_result = run_meeting_ai_pipeline(
            recording_artifact=claimed_job["recordingArtifact"],
            downloader=downloader,
            transcriber=transcriber,
            summarizer=summarizer,
        )
        transcript_result = pipeline_result["transcript"]
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
            summary_result = pipeline_result["summary"]
            client.post_job_event(
                claimed_job["id"],
                {
                    "type": "summary-artifact-stored",
                    "summaryArtifact": {
                        "model": summary_result["model"],
                        "reasoningEffort": summary_result["reasoning_effort"],
                        "text": summary_result["text"],
                    },
                },
            )
        except Exception as error:
            print(f"summary generation failed for {claimed_job['id']}: {error}")

    return {"kind": "processed", "job_id": claimed_job["id"]}
