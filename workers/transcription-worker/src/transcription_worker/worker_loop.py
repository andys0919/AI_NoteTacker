def run_transcription_worker_iteration(worker_id, client, downloader, transcriber):
    claimed_job = client.claim_next_job(worker_id)

    if not claimed_job:
        return {"kind": "idle"}

    try:
        local_audio_path = downloader.download(claimed_job["recordingArtifact"])
        transcript_result = transcriber.transcribe(local_audio_path)
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

    return {"kind": "processed", "job_id": claimed_job["id"]}
