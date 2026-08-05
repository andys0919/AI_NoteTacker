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


def _read_reasoning_effort(
    environment: Mapping[str, str | None], name: str, default: str
) -> str:
    value = (environment.get(name) or default).strip().lower()
    if value not in {"none", "low", "medium", "high", "xhigh", "max"}:
        raise ValueError(
            f"{name} must be one of none, low, medium, high, xhigh, or max"
        )
    return value


def _read_worker_config(environment: Mapping[str, str | None]) -> dict[str, str | int | None]:
    control_plane_base_url = environment.get("CONTROL_PLANE_BASE_URL")
    worker_id = environment.get("WORKER_ID")

    if not control_plane_base_url:
        raise ValueError("CONTROL_PLANE_BASE_URL is required")

    if not worker_id:
        raise ValueError("WORKER_ID is required")

    return {
        "control_plane_base_url": control_plane_base_url,
        "control_plane_timeout_seconds": _read_positive_int(
            environment, "CONTROL_PLANE_TIMEOUT_SECONDS", 30
        ),
        "internal_service_token": environment.get("INTERNAL_SERVICE_TOKEN"),
        "worker_id": worker_id,
        "poll_interval_ms": int(environment.get("POLL_INTERVAL_MS") or "1000"),
    }


def _read_summary_endpoint(environment: Mapping[str, str | None]) -> str | None:
    endpoint = environment.get("AZURE_OPENAI_SUMMARY_ENDPOINT")
    if endpoint:
        summary_url = urlparse(endpoint)
        if (
            summary_url.scheme != "https"
            or not summary_url.hostname
            or summary_url.path.rstrip("/") != "/openai/v1/responses"
        ):
            raise ValueError(
                "AZURE_OPENAI_SUMMARY_ENDPOINT must be an https URL targeting "
                "/openai/v1/responses"
            )
    return endpoint


def read_transcription_worker_config(
    environment: Mapping[str, str | None],
) -> dict[str, str | int | None]:
    whisper_model = environment.get("WHISPER_MODEL")
    deployment_mode = (environment.get("DEPLOYMENT_MODE") or "default").lower()

    if not whisper_model:
        raise ValueError("WHISPER_MODEL is required")

    mai_endpoint = environment.get("AZURE_SPEECH_MAI_ENDPOINT")
    mai_model = environment.get("AZURE_SPEECH_MAI_MODEL")
    mai_api_key = environment.get("AZURE_SPEECH_MAI_API_KEY")
    if any((mai_endpoint, mai_model, mai_api_key)) and not all(
        (mai_endpoint, mai_model, mai_api_key)
    ):
        raise ValueError(
            "AZURE_SPEECH_MAI_ENDPOINT, AZURE_SPEECH_MAI_MODEL, and "
            "AZURE_SPEECH_MAI_API_KEY must be configured together"
        )

    whisper_device = environment.get("WHISPER_DEVICE")
    if not whisper_device:
        whisper_device = "cuda" if deployment_mode == "local" else "cpu"

    return {
        **_read_worker_config(environment),
        "whisper_model": whisper_model,
        "whisper_device": whisper_device,
        "whisper_compute_type": environment.get("WHISPER_COMPUTE_TYPE") or "int8",
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
        "qwen_asr_endpoint": environment.get("QWEN_ASR_ENDPOINT"),
        "qwen_asr_model": environment.get("QWEN_ASR_MODEL"),
        "qwen_asr_timeout_seconds": _read_positive_int(
            environment, "QWEN_ASR_TIMEOUT_SECONDS", 300
        ),
        "azure_speech_mai_endpoint": mai_endpoint,
        "azure_speech_mai_model": mai_model,
        "azure_speech_mai_api_key": mai_api_key,
        "azure_speech_mai_api_version": environment.get(
            "AZURE_SPEECH_MAI_API_VERSION"
        )
        or "2025-10-15",
        "azure_speech_mai_timeout_seconds": _read_positive_int(
            environment, "AZURE_SPEECH_MAI_TIMEOUT_SECONDS", 300
        ),
    }


def read_summary_worker_config(
    environment: Mapping[str, str | None],
) -> dict[str, str | int | None]:
    return {
        **_read_worker_config(environment),
        "summary_model": environment.get("SUMMARY_MODEL") or "gpt-5.6-luna",
        "summary_reasoning_effort": _read_reasoning_effort(
            environment, "SUMMARY_REASONING_EFFORT", "high"
        ),
        "codex_cli_path": environment.get("CODEX_CLI_PATH") or "codex",
        "azure_openai_summary_endpoint": _read_summary_endpoint(environment),
        "azure_openai_summary_api_key": environment.get("AZURE_OPENAI_SUMMARY_API_KEY"),
        "azure_openai_summary_timeout_seconds": _read_positive_int(
            environment, "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS", 900
        ),
    }
