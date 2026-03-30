import os
import time

from transcription_worker.artifact_downloader import RecordingArtifactDownloader
from transcription_worker.config import read_transcription_worker_config
from transcription_worker.control_plane_client import ControlPlaneClient
from transcription_worker.faster_whisper_engine import FasterWhisperTranscriber
from transcription_worker.worker_loop import run_transcription_worker_iteration


def main() -> None:
    config = read_transcription_worker_config(os.environ)
    client = ControlPlaneClient(config["control_plane_base_url"])
    downloader = RecordingArtifactDownloader()
    transcriber = FasterWhisperTranscriber(
        model_name=str(config["whisper_model"]),
        device=str(config["whisper_device"]),
        compute_type=str(config["whisper_compute_type"]),
    )

    while True:
        try:
            result = run_transcription_worker_iteration(
                worker_id=str(config["worker_id"]),
                client=client,
                downloader=downloader,
                transcriber=transcriber,
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
