import os

from transcription_worker.heartbeat import start_lease_heartbeat


def _transcription_progress_message(provider: str) -> str:
    if provider == "azure-openai-gpt-4o-transcribe":
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

    heartbeat_stop, heartbeat_thread = start_lease_heartbeat(
        client,
        claimed_job["id"],
        "transcription",
        claimed_job.get("leaseToken"),
        heartbeat_interval_ms,
    )

    prepared_audio = None
    local_media_path = None

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

        return {"kind": "processed", "job_id": claimed_job["id"]}
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
            lease_token=claimed_job.get("leaseToken"),
        )
        return {"kind": "failed", "job_id": claimed_job["id"]}
    finally:
        # Stop the lease heartbeat on EVERY exit path (success, cancellation, or
        # failure) — including when the success-path event POST raises — so a
        # daemon heartbeat can never keep renewing the lease for a job we have
        # stopped processing. Keeping this in finally avoids the ghost-heartbeat
        # that would otherwise leave the job stuck "transcribing" with a live lease.
        if heartbeat_stop:
            heartbeat_stop.set()
        if heartbeat_thread:
            heartbeat_thread.join(timeout=1)
        # The FFmpeg-prepared WAV is a per-job temp file; remove it on every exit
        # so meeting recordings don't pile up in /tmp.
        if prepared_audio and prepared_audio.get("prepared"):
            try:
                os.remove(prepared_audio["local_audio_path"])
            except OSError:
                pass
        # The originally downloaded media is also a per-job temp file. When the audio
        # was transcoded this is a different file from the prepared WAV; when it was a
        # WAV passthrough it is the same content reused directly. Either way it must be
        # removed on every exit so source downloads don't accumulate in /tmp. (Block
        # above only removes the transcoded WAV, so there is no double-delete here.)
        if local_media_path and not (
            prepared_audio
            and prepared_audio.get("prepared")
            and prepared_audio.get("local_audio_path") == local_media_path
        ):
            try:
                os.remove(local_media_path)
            except OSError:
                pass
