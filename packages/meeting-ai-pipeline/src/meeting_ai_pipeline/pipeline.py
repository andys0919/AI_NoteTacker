from typing import Any


def run_meeting_ai_pipeline(recording_artifact: dict[str, Any], downloader, transcriber, summarizer=None):
    local_audio_path = downloader.download(recording_artifact)
    transcript_result = transcriber.transcribe(local_audio_path)
    summary_result = summarizer.summarize(transcript_result) if summarizer is not None else None

    return {
        "local_audio_path": local_audio_path,
        "transcript": transcript_result,
        "summary": summary_result,
    }
