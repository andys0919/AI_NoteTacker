from typing import Mapping
from urllib.parse import urlparse

# Default style hint sent to gpt-4o-transcribe. It preserves code-switching instead
# of forcing every recording into one language; Chinese display normalization is a
# separate deterministic stage.
DEFAULT_AZURE_TRANSCRIBE_PROMPT = (
    "請忠實轉錄語音並保留原本語言，不要翻譯。中英或其他語言混用時原樣保留；"
    "中文內容使用正體中文。只記錄實際說出的內容，不要依提示補入未說出的詞。"
)


def _read_positive_int(
    environment: Mapping[str, str | None], name: str, default: int
) -> int:
    try:
        value = int(environment.get(name) or str(default))
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def read_transcription_worker_config(environment: Mapping[str, str | None]) -> dict[str, str | int]:
    control_plane_base_url = environment.get("CONTROL_PLANE_BASE_URL")
    worker_id = environment.get("WORKER_ID")
    whisper_model = environment.get("WHISPER_MODEL")
    deployment_mode = (environment.get("DEPLOYMENT_MODE") or "default").lower()

    if not control_plane_base_url:
        raise ValueError("CONTROL_PLANE_BASE_URL is required")

    if not worker_id:
        raise ValueError("WORKER_ID is required")

    if not whisper_model:
        raise ValueError("WHISPER_MODEL is required")

    whisper_device = environment.get("WHISPER_DEVICE")
    if not whisper_device:
        whisper_device = "cuda" if deployment_mode == "local" else "cpu"

    summary_model = environment.get("SUMMARY_MODEL")
    if not summary_model:
        summary_model = "gpt-5.4-mini"

    azure_openai_summary_endpoint = environment.get("AZURE_OPENAI_SUMMARY_ENDPOINT")
    if azure_openai_summary_endpoint:
        summary_url = urlparse(azure_openai_summary_endpoint)
        if (
            summary_url.scheme != "https"
            or not summary_url.hostname
            or summary_url.path.rstrip("/") != "/openai/v1/responses"
        ):
            raise ValueError(
                "AZURE_OPENAI_SUMMARY_ENDPOINT must be an https URL targeting "
                "/openai/v1/responses"
            )

    return {
        "control_plane_base_url": control_plane_base_url,
        "control_plane_timeout_seconds": _read_positive_int(
            environment, "CONTROL_PLANE_TIMEOUT_SECONDS", 30
        ),
        "internal_service_token": environment.get("INTERNAL_SERVICE_TOKEN"),
        "worker_id": worker_id,
        "deployment_mode": deployment_mode,
        "whisper_model": whisper_model,
        "whisper_device": whisper_device,
        "whisper_compute_type": environment.get("WHISPER_COMPUTE_TYPE") or "int8",
        "summary_enabled": (environment.get("SUMMARY_ENABLED") or "false").lower() == "true",
        "summary_model": summary_model,
        "summary_reasoning_effort": environment.get("SUMMARY_REASONING_EFFORT") or "medium",
        "codex_cli_path": environment.get("CODEX_CLI_PATH") or "codex",
        "azure_openai_summary_endpoint": azure_openai_summary_endpoint,
        "azure_openai_summary_api_key": environment.get("AZURE_OPENAI_SUMMARY_API_KEY"),
        "azure_openai_summary_timeout_seconds": _read_positive_int(
            environment, "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS", 300
        ),
        "poll_interval_ms": int(environment.get("POLL_INTERVAL_MS") or "1000"),
        "azure_openai_endpoint": environment.get("AZURE_OPENAI_ENDPOINT"),
        "azure_openai_deployment": environment.get("AZURE_OPENAI_DEPLOYMENT"),
        "azure_openai_api_key": environment.get("AZURE_OPENAI_API_KEY"),
        "azure_openai_api_version": environment.get("AZURE_OPENAI_API_VERSION")
        or "2025-03-01-preview",
        "azure_openai_transcribe_timeout_seconds": _read_positive_int(
            environment, "AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS", 300
        ),
        "azure_openai_transcribe_language": environment.get("AZURE_OPENAI_TRANSCRIBE_LANGUAGE")
        or "",
        "azure_openai_transcribe_prompt": environment.get("AZURE_OPENAI_TRANSCRIBE_PROMPT")
        or DEFAULT_AZURE_TRANSCRIBE_PROMPT,
        "transcript_punctuation_enabled": (
            environment.get("TRANSCRIPT_PUNCTUATION_ENABLED") or "true"
        ).lower()
        == "true",
        "transcript_punctuation_model": environment.get("AZURE_OPENAI_PUNCTUATION_MODEL")
        or summary_model,
        "azure_openai_punctuation_timeout_seconds": _read_positive_int(
            environment, "AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS", 30
        ),
    }
