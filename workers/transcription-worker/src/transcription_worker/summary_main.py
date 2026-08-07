import os
import time
from functools import partial

from transcription_worker.azure_openai_transcript_summarizer import AzureOpenAiTranscriptSummarizer
from transcription_worker.codex_transcript_summarizer import (
    CodexTranscriptSummarizer,
    is_codex_quota_exhausted,
    read_codex_weekly_usage,
)
from transcription_worker.config import read_summary_worker_config
from transcription_worker.control_plane_client import ControlPlaneClient
from transcription_worker.summary_worker_loop import run_summary_worker_iteration


def main() -> None:
    config = read_summary_worker_config(os.environ)
    client = ControlPlaneClient(
        str(config["control_plane_base_url"]),
        internal_service_token=str(config["internal_service_token"])
        if config.get("internal_service_token")
        else None,
        timeout_seconds=int(config["control_plane_timeout_seconds"]),
    )
    codex_cli_path = str(config["codex_cli_path"])
    summarizer = CodexTranscriptSummarizer(
        model=str(config["summary_model"]),
        reasoning_effort=str(config["summary_reasoning_effort"]),
        codex_cli_path=codex_cli_path,
        timeout_seconds=int(config["summary_timeout_seconds"]),
    )
    azure_fallback_summarizer = None
    if config.get("azure_openai_summary_endpoint") and config.get(
        "azure_openai_summary_api_key"
    ):
        azure_fallback_summarizer = AzureOpenAiTranscriptSummarizer(
            endpoint=str(config["azure_openai_summary_endpoint"]),
            api_key=str(config["azure_openai_summary_api_key"]),
            model=str(config["summary_model"]),
            reasoning_effort=str(config["summary_reasoning_effort"]),
            timeout_seconds=int(config["azure_openai_summary_timeout_seconds"]),
        )

    codex_usage = None
    next_codex_usage_refresh_at = 0.0
    while True:
        try:
            if time.monotonic() >= next_codex_usage_refresh_at:
                codex_usage = read_codex_weekly_usage(codex_cli_path=codex_cli_path)
                next_codex_usage_refresh_at = time.monotonic() + 60
            result = run_summary_worker_iteration(
                worker_id=str(config["worker_id"]),
                client=client,
                summarizer=summarizer,
                azure_fallback_summarizer=azure_fallback_summarizer,
                quota_is_exhausted=partial(
                    is_codex_quota_exhausted, codex_cli_path=codex_cli_path
                ),
                codex_usage=codex_usage,
            )

            if result["kind"] == "idle":
                time.sleep(int(config["poll_interval_ms"]) / 1000)
                continue

            print(f"processed summary job {result['job_id']}")
        except Exception as error:  # noqa: BLE001
            print(f"summary worker iteration failed: {error}")
            time.sleep(int(config["poll_interval_ms"]) / 1000)


if __name__ == "__main__":
    main()
