from typing import Mapping

# Default style hint sent to gpt-4o-transcribe as the `prompt` field. The model has
# no explicit traditional/simplified toggle, so we bias it with a natural Traditional
# Chinese (Taiwan) sentence that already carries punctuation. Override per-deployment
# with AZURE_OPENAI_TRANSCRIBE_PROMPT (e.g. for English-first meetings).
DEFAULT_AZURE_TRANSCRIBE_PROMPT = (
    "這是一場以繁體中文進行的會議，以下為完整逐字稿，"
    "內容使用繁體中文（台灣用語）並保留正確的標點符號，例如，。、？！。"
)


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
    if not azure_openai_summary_endpoint and environment.get("AZURE_OPENAI_ENDPOINT"):
        azure_openai_summary_endpoint = (
            environment["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/chat/completions"
        )

    return {
        "control_plane_base_url": control_plane_base_url,
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
        "azure_openai_summary_api_key": environment.get("AZURE_OPENAI_SUMMARY_API_KEY")
        or environment.get("AZURE_OPENAI_API_KEY"),
        "poll_interval_ms": int(environment.get("POLL_INTERVAL_MS") or "1000"),
        "azure_openai_endpoint": environment.get("AZURE_OPENAI_ENDPOINT"),
        "azure_openai_deployment": environment.get("AZURE_OPENAI_DEPLOYMENT"),
        "azure_openai_api_key": environment.get("AZURE_OPENAI_API_KEY"),
        "azure_openai_api_version": environment.get("AZURE_OPENAI_API_VERSION")
        or "2025-03-01-preview",
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
    }
