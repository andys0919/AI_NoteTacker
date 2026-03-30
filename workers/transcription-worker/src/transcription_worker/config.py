from typing import Mapping


def read_transcription_worker_config(environment: Mapping[str, str | None]) -> dict[str, str | int]:
    control_plane_base_url = environment.get("CONTROL_PLANE_BASE_URL")
    worker_id = environment.get("WORKER_ID")
    whisper_model = environment.get("WHISPER_MODEL")

    if not control_plane_base_url:
        raise ValueError("CONTROL_PLANE_BASE_URL is required")

    if not worker_id:
        raise ValueError("WORKER_ID is required")

    if not whisper_model:
        raise ValueError("WHISPER_MODEL is required")

    return {
        "control_plane_base_url": control_plane_base_url,
        "worker_id": worker_id,
        "whisper_model": whisper_model,
        "whisper_device": environment.get("WHISPER_DEVICE") or "cpu",
        "whisper_compute_type": environment.get("WHISPER_COMPUTE_TYPE") or "int8",
        "poll_interval_ms": int(environment.get("POLL_INTERVAL_MS") or "1000"),
    }
