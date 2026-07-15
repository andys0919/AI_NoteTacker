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


def _post_terminal_event(client, job_id, payload, lease_token):
    try:
        client.post_job_event(job_id, payload, lease_token=lease_token)
    except Exception:
        client.post_job_event(job_id, payload, lease_token=lease_token)


def _to_artifact_review_flag(flag: dict) -> dict:
    result = {
        "reason": flag["reason"],
        "originalText": flag["original_text"],
        "candidates": flag.get("candidates", []),
    }
    for source, target in (
        ("start_ms", "startMs"),
        ("end_ms", "endMs"),
        ("evidence", "evidence"),
    ):
        if source in flag:
            result[target] = flag[source]
    return result


def _to_artifact_segment(segment: dict) -> dict:
    result = {
        "startMs": segment["start_ms"],
        "endMs": segment["end_ms"],
        "text": segment.get("display_text") or segment["text"],
    }
    for source, target in (
        ("raw_text", "rawText"),
        ("display_text", "displayText"),
        ("language", "language"),
        ("language_confidence", "languageConfidence"),
        ("timing_source", "timingSource"),
    ):
        if source in segment:
            result[target] = segment[source]
    if "review_flags" in segment:
        result["reviewFlags"] = [
            _to_artifact_review_flag(flag) for flag in segment["review_flags"]
        ]
    return result


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
    punctuation_usage = None
    transcription_audio_ms = 0
    transcription_completed = False

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

        def report_punctuation_usage(update):
            nonlocal punctuation_usage

            if punctuation_usage is None:
                punctuation_usage = {
                    "provider": "azure-openai",
                    "model": update["model"],
                    "inputTokens": 0,
                    "cachedInputTokens": 0,
                    "outputTokens": 0,
                    "reasoningOutputTokens": 0,
                    "totalTokens": 0,
                    "requestCount": 0,
                    "acceptedChunkCount": 0,
                    "fallbackChunkCount": 0,
                    "unmeteredRequestCount": 0,
                }

            for target, source in (
                ("inputTokens", "input_tokens"),
                ("cachedInputTokens", "cached_input_tokens"),
                ("outputTokens", "output_tokens"),
                ("reasoningOutputTokens", "reasoning_output_tokens"),
                ("totalTokens", "total_tokens"),
                ("requestCount", "request_count"),
                ("acceptedChunkCount", "accepted_chunk_count"),
                ("fallbackChunkCount", "fallback_chunk_count"),
                ("unmeteredRequestCount", "unmetered_request_count"),
            ):
                punctuation_usage[target] += update[source]

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

        def report_transcription_usage(update):
            nonlocal transcription_audio_ms
            transcription_audio_ms += update["audio_ms"]

        if transcription_provider == "azure-openai-gpt-4o-transcribe":
            transcript_result = selected_transcriber.transcribe(
                prepared_audio["local_audio_path"],
                on_progress=report_transcription_progress,
                on_punctuation_usage=report_punctuation_usage,
                on_transcription_usage=report_transcription_usage,
                workflow_context={
                    "template_id": claimed_job.get("submissionTemplateId") or "general"
                },
            )
        else:
            transcript_result = selected_transcriber.transcribe(
                prepared_audio["local_audio_path"],
                on_progress=report_transcription_progress,
            )
        transcription_completed = True

        artifact_segments = [
            _to_artifact_segment(segment) for segment in transcript_result["segments"]
        ]
        transcript_artifact = {
            "storageKey": f"transcripts/{claimed_job['id']}/transcript.json",
            "downloadUrl": f"{claimed_job['recordingArtifact']['downloadUrl']}.transcript.json",
            "contentType": "application/json",
            "language": transcript_result["language"],
            "segments": artifact_segments,
        }
        if any("rawText" in segment for segment in artifact_segments):
            transcript_artifact["schemaVersion"] = 2

        transcript_event = {
            "type": "transcript-artifact-stored",
            "transcriptArtifact": transcript_artifact,
        }
        event_usage = {}
        audio_ms = transcription_audio_ms or transcript_result.get("usage", {}).get("audio_ms")
        if audio_ms is not None:
            event_usage["audioMs"] = audio_ms
        if punctuation_usage and punctuation_usage["requestCount"] > 0:
            event_usage["punctuation"] = punctuation_usage
        if event_usage:
            transcript_event["usage"] = event_usage
        _post_terminal_event(
            client,
            claimed_job["id"],
            transcript_event,
            claimed_job.get("leaseToken"),
        )

        return {"kind": "processed", "job_id": claimed_job["id"]}
    except JobCancelledError:
        event_usage = {}
        if transcription_audio_ms > 0:
            event_usage["audioMs"] = transcription_audio_ms
        if punctuation_usage and punctuation_usage["requestCount"] > 0:
            event_usage["punctuation"] = punctuation_usage
        if event_usage:
            _post_terminal_event(
                client,
                claimed_job["id"],
                {
                    "type": "transcription-failed",
                    "failure": {
                        "code": "operator-cancel-requested",
                        "message": "job cancelled by operator",
                    },
                    "usage": event_usage,
                },
                claimed_job.get("leaseToken"),
            )
        return {"kind": "cancelled", "job_id": claimed_job["id"]}
    except Exception as error:
        if transcription_completed:
            raise

        failure_event = {
            "type": "transcription-failed",
            "failure": {
                "code": "transcription-failed",
                "message": str(error),
            },
        }
        event_usage = {}
        if transcription_audio_ms > 0:
            event_usage["audioMs"] = transcription_audio_ms
        if punctuation_usage and punctuation_usage["requestCount"] > 0:
            event_usage["punctuation"] = punctuation_usage
        if event_usage:
            failure_event["usage"] = event_usage
        _post_terminal_event(
            client,
            claimed_job["id"],
            failure_event,
            claimed_job.get("leaseToken"),
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
