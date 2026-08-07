import json
import os
import signal
import subprocess
import time
import uuid
from datetime import datetime, timezone
from math import isfinite
from queue import Empty, Queue
from tempfile import TemporaryDirectory
from threading import Thread
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from transcription_worker.transcript_summary import (
    build_summary_prompt,
    coerce_summary_payload,
    render_summary_markdown,
)


def _terminate_process_group(
    process: subprocess.Popen[str], terminate_grace_seconds: int | float = 2
) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return

    deadline = time.monotonic() + terminate_grace_seconds
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            process.wait()
            return
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def _codex_environment() -> dict[str, str]:
    return {
        name: value
        for name in (
            "CODEX_HOME",
            "HOME",
            "LANG",
            "LC_ALL",
            "PATH",
            "SSL_CERT_DIR",
            "SSL_CERT_FILE",
        )
        if (value := os.environ.get(name)) is not None
    }


def _rate_limit_snapshot_is_exhausted(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    snapshot = payload.get("rateLimits")
    return (
        isinstance(snapshot, dict)
        and snapshot.get("rateLimitReachedType") is not None
    )


def read_codex_rate_limits(
    codex_cli_path: str = "codex",
    timeout_seconds: int | float = 15,
) -> dict[str, Any] | None:
    command = [
        codex_cli_path,
        "app-server",
        "--stdio",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--disable",
        "code_mode_host",
        "-c",
        "allow_login_shell=false",
        "-c",
        'shell_environment_policy.inherit="none"',
    ]
    initialize_message = {
        "method": "initialize",
        "id": 1,
        "params": {
            "clientInfo": {
                "name": "ai_notetacker_summary_worker",
                "title": "AI NoteTacker summary worker",
                "version": "1",
            }
        },
    }

    with TemporaryDirectory(prefix="codex-quota-") as working_directory:
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                env=_codex_environment(),
                cwd=working_directory,
                start_new_session=True,
            )
        except OSError:
            return None
        reader: Thread | None = None
        try:
            assert process.stdin is not None
            assert process.stdout is not None
            responses: Queue[str | None] = Queue()

            def read_responses() -> None:
                try:
                    for line in process.stdout:
                        responses.put(line)
                finally:
                    responses.put(None)

            reader = Thread(target=read_responses, daemon=True)
            reader.start()
            process.stdin.write(json.dumps(initialize_message) + "\n")
            process.stdin.flush()

            deadline = time.monotonic() + timeout_seconds

            def read_response(response_id: int) -> dict[str, Any] | None:
                while time.monotonic() < deadline:
                    try:
                        line = responses.get(
                            timeout=max(0, deadline - time.monotonic())
                        )
                    except Empty:
                        return None
                    if line is None:
                        return None

                    try:
                        response = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if response.get("id") == response_id:
                        return response
                return None

            initialize_response = read_response(1)
            if not initialize_response or initialize_response.get("error") is not None:
                return None

            process.stdin.write(json.dumps({"method": "initialized"}) + "\n")
            process.stdin.write(
                json.dumps({"method": "account/rateLimits/read", "id": 2}) + "\n"
            )
            process.stdin.flush()

            rate_limit_response = read_response(2)
            if not rate_limit_response or rate_limit_response.get("error") is not None:
                return None
            result = rate_limit_response.get("result")
            return result if isinstance(result, dict) else None
        except (OSError, ValueError):
            return None
        finally:
            _terminate_process_group(process)
            if process.stdin:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()
            if reader:
                reader.join(timeout=1)

    return None


def is_codex_quota_exhausted(
    codex_cli_path: str = "codex",
    timeout_seconds: int | float = 15,
) -> bool:
    return _rate_limit_snapshot_is_exhausted(
        read_codex_rate_limits(codex_cli_path, timeout_seconds)
    )


def codex_weekly_usage_from_rate_limits(
    payload: object,
    *,
    checked_at: str | None = None,
) -> dict[str, Any]:
    observed_at = checked_at or datetime.now(timezone.utc).isoformat()
    unavailable = {
        "status": "unavailable",
        "reason": "weekly-window-unavailable",
        "checkedAt": observed_at,
    }
    if not isinstance(payload, dict):
        return unavailable

    rate_limits_by_id = payload.get("rateLimitsByLimitId")
    snapshot = (
        rate_limits_by_id.get("codex")
        if isinstance(rate_limits_by_id, dict)
        else None
    )
    if not isinstance(snapshot, dict):
        snapshot = payload.get("rateLimits")
    if not isinstance(snapshot, dict):
        return unavailable

    weekly = next(
        (
            bucket
            for bucket in (snapshot.get("primary"), snapshot.get("secondary"))
            if isinstance(bucket, dict)
            and bucket.get("windowDurationMins") == 7 * 24 * 60
        ),
        None,
    )
    if not isinstance(weekly, dict):
        return unavailable

    used_percent = weekly.get("usedPercent")
    resets_at = weekly.get("resetsAt")
    if (
        isinstance(used_percent, bool)
        or not isinstance(used_percent, (int, float))
        or not isfinite(used_percent)
        or not 0 <= used_percent <= 100
        or isinstance(resets_at, bool)
        or not isinstance(resets_at, (int, float))
        or not isfinite(resets_at)
        or resets_at <= 0
    ):
        return unavailable

    result = {
        "status": "available",
        "usedPercent": float(used_percent),
        "windowDurationMins": 7 * 24 * 60,
        "resetsAt": int(resets_at),
        "checkedAt": observed_at,
    }
    if isinstance(snapshot.get("planType"), str):
        result["planType"] = snapshot["planType"]
    return result


def read_codex_weekly_usage(
    codex_cli_path: str = "codex",
    timeout_seconds: int | float = 15,
) -> dict[str, Any]:
    checked_at = datetime.now(timezone.utc).isoformat()
    payload = read_codex_rate_limits(codex_cli_path, timeout_seconds)
    if payload is None:
        return {
            "status": "unavailable",
            "reason": "probe-failed",
            "checkedAt": checked_at,
        }
    return codex_weekly_usage_from_rate_limits(payload, checked_at=checked_at)


def _request_codex_pty(
    *,
    api_url: str,
    api_token: str,
    prompt: str,
    timeout_seconds: int | float,
) -> str:
    request = Request(
        api_url,
        data=json.dumps({"prompt": prompt}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(4 * 1024 * 1024 + 1)
    except HTTPError as error:
        detail = error.read(4096).decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"Codex PTY API returned HTTP {error.code}: {detail or error.reason}"
        ) from error
    except URLError as error:
        raise RuntimeError(f"Codex PTY API request failed: {error.reason}") from error

    if len(body) > 4 * 1024 * 1024:
        raise RuntimeError("Codex PTY API response exceeds 4 MiB")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError("Codex PTY API returned invalid JSON") from error
    summary_text = payload.get("response") if isinstance(payload, dict) else None
    if not isinstance(summary_text, str) or not summary_text.strip():
        raise RuntimeError("Codex PTY API returned no response text")
    return summary_text.strip()


class CodexTranscriptSummarizer:
    def __init__(
        self,
        model: str,
        reasoning_effort: str,
        api_url: str,
        api_token: str,
        timeout_seconds: int = 900,
        requester=None,
    ) -> None:
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._api_url = api_url
        self._api_token = api_token
        self._timeout_seconds = timeout_seconds
        self._requester = requester or _request_codex_pty

    def summarize(
        self,
        transcript_result: dict[str, Any],
        summary_profile: str = "general",
        model_override: str | None = None,
        on_provider_request=None,
    ) -> dict[str, Any]:
        prompt = build_summary_prompt(transcript_result, summary_profile=summary_profile)
        model = self._model
        request_id = uuid.uuid4().hex
        if on_provider_request is not None:
            on_provider_request(
                {
                    "action": "start",
                    "requestId": request_id,
                    "provider": "local-codex",
                    "model": model,
                    "operation": "summary",
                }
            )
        try:
            summary_text = self._requester(
                api_url=self._api_url,
                api_token=self._api_token,
                prompt=prompt,
                timeout_seconds=self._timeout_seconds,
            )
        except Exception as error:
            if on_provider_request is not None:
                on_provider_request(
                    {
                        "action": "finish",
                        "requestId": request_id,
                        "status": "failed",
                        "errorCode": type(error).__name__,
                    }
                )
            raise

        usage = None
        try:
            summary_payload = coerce_summary_payload(
                summary_text,
                provider_label="codex",
                require_complete_schema=True,
            )
            summary = {
                "model": model,
                "reasoning_effort": self._reasoning_effort,
                "text": render_summary_markdown(summary_payload),
                "structured": {
                    "title": summary_payload["title"],
                    "summary": summary_payload["summary"],
                    "topics": summary_payload["topics"],
                    "follow_up_groups": summary_payload["follow_up_groups"],
                    "analysis_notes": summary_payload["analysis_notes"],
                    "key_points": summary_payload["key_points"],
                    "action_items": summary_payload["action_items"],
                    "decisions": summary_payload["decisions"],
                    "risks": summary_payload["risks"],
                    "open_questions": summary_payload["open_questions"],
                },
            }
        except Exception as error:
            if on_provider_request is not None:
                on_provider_request(
                    {
                        "action": "finish",
                        "requestId": request_id,
                        "status": "failed",
                        "errorCode": "response-validation-failed",
                        "usage": usage,
                    }
                )
            raise

        if on_provider_request is not None:
            on_provider_request(
                {
                    "action": "finish",
                    "requestId": request_id,
                    "status": "succeeded",
                    "usage": usage,
                }
            )
        return summary
