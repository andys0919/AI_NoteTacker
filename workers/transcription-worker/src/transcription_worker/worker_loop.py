import threading


def _transcription_progress_message(provider: str) -> str:
    if provider == "azure-openai-gpt-4o-mini-transcribe":
        return "Running Azure OpenAI transcription."

    return "Running Whisper transcription."


def _post_progress(
    client,
    job_id: str,
    processing_stage: str,
    processing_message: str,
    lease_token: str | None = None,
) -> None:
    client.post_job_event(
        job_id,
        {
            "type": "progress-updated",
            "processingStage": processing_stage,
            "processingMessage": processing_message,
        },
        lease_token=lease_token,
    )


class JobCancelledError(RuntimeError):
    pass


def _start_lease_heartbeat(client, job_id: str, stage: str, lease_token: str | None, heartbeat_interval_ms: int):
    if not lease_token or heartbeat_interval_ms <= 0:
        return None, None

    stop_event = threading.Event()

    def heartbeat_loop() -> None:
        interval_seconds = heartbeat_interval_ms / 1000

        while not stop_event.wait(interval_seconds):
            try:
                client.post_lease_heartbeat(job_id, stage, lease_token)
            except Exception:  # noqa: BLE001
                return

    thread = threading.Thread(target=heartbeat_loop, daemon=True)
    thread.start()
    return stop_event, thread


def run_transcription_worker_iteration(
    worker_id,
    client,
    downloader,
    media_preparer,
    transcriber,
    summarizer=None,
    transcriber_registry=None,
    summarizer_registry=None,
    sleep_fn=None,
    heartbeat_interval_ms=30_000,
):
    claimed_job = client.claim_next_job(worker_id)

    if not claimed_job:
        return {"kind": "idle"}

    heartbeat_stop, heartbeat_thread = _start_lease_heartbeat(
        client,
        claimed_job["id"],
        "transcription",
        claimed_job.get("leaseToken"),
        heartbeat_interval_ms,
    )

    try:
        transcription_provider = claimed_job.get("transcriptionProvider") or "self-hosted-whisper"
        selected_transcriber = (
            transcriber_registry.get(transcription_provider)
            if transcriber_registry is not None
            else transcriber
        )
        progress_message = _transcription_progress_message(transcription_provider)
        recording_artifact = claimed_job["recordingArtifact"]
        _post_progress(
            client,
            claimed_job["id"],
            "preparing-media",
            "Downloading source media for transcription.",
            lease_token=claimed_job.get("leaseToken"),
        )
        local_media_path = downloader.download(recording_artifact)

        _post_progress(
            client,
            claimed_job["id"],
            "preparing-media",
            "Preparing canonical audio for transcription.",
            lease_token=claimed_job.get("leaseToken"),
        )
        prepared_audio = media_preparer.prepare(
            local_media_path,
            recording_artifact["contentType"],
        )

        _post_progress(
            client,
            claimed_job["id"],
            "transcribing-audio",
            progress_message,
            lease_token=claimed_job.get("leaseToken"),
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
                    "processingMessage": progress_message,
                    "progressPercent": percent,
                    "progressProcessedMs": update["processed_ms"],
                    "progressTotalMs": update["total_ms"],
                },
                lease_token=claimed_job.get("leaseToken"),
            )

            latest_job = client.get_job(claimed_job["id"])
            if (
                latest_job
                and latest_job.get("state") == "failed"
                and latest_job.get("failureCode") == "operator-cancel-requested"
            ):
                raise JobCancelledError("job cancelled by operator")

        transcript_result = selected_transcriber.transcribe(
            prepared_audio["local_audio_path"],
            on_progress=report_transcription_progress,
        )
    except JobCancelledError:
        if heartbeat_stop:
            heartbeat_stop.set()
        if heartbeat_thread:
            heartbeat_thread.join(timeout=1)
        return {"kind": "cancelled", "job_id": claimed_job["id"]}
    except Exception as error:
        if heartbeat_stop:
            heartbeat_stop.set()
        if heartbeat_thread:
            heartbeat_thread.join(timeout=1)
        client.post_job_event(
            claimed_job["id"],
            {
                "type": "transcription-failed",
                "failure": {
                    "code": "transcription-failed",
                    "message": str(error),
                },
            },
            lease_token=claimed_job.get("leaseToken"),
        )
        return {"kind": "failed", "job_id": claimed_job["id"]}

    transcript_event = {
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
    }
    if transcript_result.get("usage", {}).get("audio_ms") is not None:
        transcript_event["usage"] = {
            "audioMs": transcript_result["usage"]["audio_ms"],
        }
    client.post_job_event(
        claimed_job["id"],
        transcript_event,
        lease_token=claimed_job.get("leaseToken"),
    )

    if heartbeat_stop:
        heartbeat_stop.set()
    if heartbeat_thread:
        heartbeat_thread.join(timeout=1)

    return {"kind": "processed", "job_id": claimed_job["id"]}
