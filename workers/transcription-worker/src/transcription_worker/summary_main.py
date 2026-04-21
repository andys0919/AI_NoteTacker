import os
import time

from transcription_worker.azure_openai_transcript_summarizer import AzureOpenAiTranscriptSummarizer
from transcription_worker.codex_transcript_summarizer import CodexTranscriptSummarizer
from transcription_worker.config import read_transcription_worker_config
from transcription_worker.control_plane_client import ControlPlaneClient
from transcription_worker.summary_worker_loop import run_summary_worker_iteration


def main() -> None:
    config = read_transcription_worker_config(os.environ)
    client = ControlPlaneClient(
        str(config["control_plane_base_url"]),
        internal_service_token=str(config["internal_service_token"])
        if config.get("internal_service_token")
        else None,
    )
    local_summarizer = CodexTranscriptSummarizer(
        model=str(config["summary_model"]),
        reasoning_effort=str(config["summary_reasoning_effort"]),
        codex_cli_path=str(config["codex_cli_path"]),
    )
    summarizer = local_summarizer
    summarizer_registry = {"local-codex": local_summarizer}

    if config.get("azure_openai_summary_endpoint") and config.get("azure_openai_summary_api_key"):
        summarizer_registry["azure-openai"] = AzureOpenAiTranscriptSummarizer(
            endpoint=str(config["azure_openai_summary_endpoint"]),
            api_key=str(config["azure_openai_summary_api_key"]),
            model=str(config["summary_model"]),
        )

    while True:
        try:
            result = run_summary_worker_iteration(
                worker_id=str(config["worker_id"]),
                client=client,
                summarizer=summarizer,
                summarizer_registry=summarizer_registry,
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
