import os
import time

from meeting_ai_pipeline.artifact_downloader import RecordingArtifactDownloader, S3ArtifactStorage
from transcription_worker.azure_openai_transcriber import AzureOpenAiTranscriber
from transcription_worker.config import read_transcription_worker_config
from transcription_worker.control_plane_client import ControlPlaneClient
from transcription_worker.faster_whisper_engine import FasterWhisperTranscriber
from transcription_worker.media_preparer import FFmpegMediaPreparer
from transcription_worker.worker_loop import run_transcription_worker_iteration


def build_object_storage_from_environment(environment: dict[str, str]) -> S3ArtifactStorage | None:
    required_keys = (
        "S3_BUCKET_NAME",
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
    )

    if not all(environment.get(key) for key in required_keys):
        return None

    return S3ArtifactStorage(
        bucket_name=environment["S3_BUCKET_NAME"],
        endpoint_url=environment["S3_ENDPOINT"],
        region_name=environment["S3_REGION"],
        access_key_id=environment["S3_ACCESS_KEY_ID"],
        secret_access_key=environment["S3_SECRET_ACCESS_KEY"],
    )


def main() -> None:
    config = read_transcription_worker_config(os.environ)
    client = ControlPlaneClient(
        str(config["control_plane_base_url"]),
        internal_service_token=str(config["internal_service_token"])
        if config.get("internal_service_token")
        else None,
    )
    downloader = RecordingArtifactDownloader(
        object_storage=build_object_storage_from_environment(os.environ),
    )
    media_preparer = FFmpegMediaPreparer()
    transcriber = FasterWhisperTranscriber(
        model_name=str(config["whisper_model"]),
        device=str(config["whisper_device"]),
        compute_type=str(config["whisper_compute_type"]),
    )
    transcriber_registry = {
        "self-hosted-whisper": transcriber,
    }
    if (
        config.get("azure_openai_endpoint")
        and config.get("azure_openai_deployment")
        and config.get("azure_openai_api_key")
    ):
        transcriber_registry["azure-openai-gpt-4o-mini-transcribe"] = AzureOpenAiTranscriber(
            endpoint=str(config["azure_openai_endpoint"]),
            deployment=str(config["azure_openai_deployment"]),
            api_key=str(config["azure_openai_api_key"]),
            api_version=str(config["azure_openai_api_version"]),
        )
    while True:
        try:
            result = run_transcription_worker_iteration(
                worker_id=str(config["worker_id"]),
                client=client,
                downloader=downloader,
                media_preparer=media_preparer,
                transcriber=transcriber,
                transcriber_registry=transcriber_registry,
            )

            if result["kind"] == "idle":
                time.sleep(int(config["poll_interval_ms"]) / 1000)
                continue

            print(f"processed transcription job {result['job_id']}")
        except Exception as error:  # noqa: BLE001
            print(f"transcription worker iteration failed: {error}")
            time.sleep(int(config["poll_interval_ms"]) / 1000)


if __name__ == "__main__":
    main()
