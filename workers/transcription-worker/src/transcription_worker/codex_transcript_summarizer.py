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


def _run_codex_process(
    command: list[str],
    *,
    prompt: str,
    environment: dict[str, str],
    working_directory: str,
    timeout_seconds: int | float,
    terminate_grace_seconds: int | float = 2,
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
        cwd=working_directory,
        start_new_session=True,
    )

    try:
        stdout, stderr = process.communicate(input=prompt, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as error:
        _terminate_process_group(process, terminate_grace_seconds)
        process.communicate()
        raise RuntimeError(f"codex timed out after {timeout_seconds} seconds") from error

    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


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


def _extract_summary_text(stdout_text: str) -> str:
    parts: list[str] = []

    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Codex may emit non-JSON lines that happen to start with '{'; skip them
            # instead of crashing the whole summarization job.
            continue
        if event.get("type") != "item.completed":
            continue

        item = event.get("item") or {}
        if item.get("type") == "agent_message" and str(item.get("text", "")).strip():
            parts.append(str(item["text"]).strip())

    return "\n".join(parts).strip()


def _extract_codex_error_message(stdout_text: str) -> str | None:
    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "error" and str(event.get("message", "")).strip():
            return str(event["message"]).strip()

        turn_error = event.get("error")
        if isinstance(turn_error, dict) and str(turn_error.get("message", "")).strip():
            return str(turn_error["message"]).strip()

    return None


def _extract_codex_usage(stdout_text: str) -> dict[str, int] | None:
    for line in reversed(stdout_text.splitlines()):
        try:
            event = json.loads(line.strip())
        except (json.JSONDecodeError, AttributeError):
            continue
        if event.get("type") != "turn.completed" or not isinstance(
            event.get("usage"), dict
        ):
            continue
        usage = event["usage"]
        input_tokens = usage.get("input_tokens")
        cached_input_tokens = usage.get("cached_input_tokens", 0)
        output_tokens = usage.get("output_tokens")
        reasoning_output_tokens = usage.get("reasoning_output_tokens", 0)
        if any(
            type(value) is not int or value < 0
            for value in (
                input_tokens,
                cached_input_tokens,
                output_tokens,
                reasoning_output_tokens,
            )
        ) or cached_input_tokens > input_tokens or reasoning_output_tokens > output_tokens:
            return None
        return {
            "inputTokens": input_tokens,
            "cachedInputTokens": cached_input_tokens,
            "outputTokens": output_tokens,
            "reasoningOutputTokens": reasoning_output_tokens,
            "totalTokens": input_tokens + output_tokens,
        }
    return None


class CodexTranscriptSummarizer:
    def __init__(
        self,
        model: str,
        reasoning_effort: str,
        codex_cli_path: str = "codex",
        timeout_seconds: int = 900,
        runner=None,
    ) -> None:
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._codex_cli_path = codex_cli_path
        self._timeout_seconds = timeout_seconds
        self._runner = runner

    def summarize(
        self,
        transcript_result: dict[str, Any],
        summary_profile: str = "general",
        model_override: str | None = None,
        on_provider_request=None,
    ) -> dict[str, Any]:
        prompt = build_summary_prompt(transcript_result, summary_profile=summary_profile)
        model = model_override or self._model
        command = [
            self._codex_cli_path,
            "exec",
            "--ignore-user-config",
            "--ignore-rules",
            "--disable",
            "shell_tool",
            "--disable",
            "unified_exec",
            "--disable",
            "code_mode_host",
            "--json",
            "--color",
            "never",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--model",
            model,
            "-c",
            f"model_reasoning_effort={self._reasoning_effort}",
            "-c",
            "allow_login_shell=false",
            "-c",
            'shell_environment_policy.inherit="none"',
            "--",
            "-",
        ]
        codex_environment = _codex_environment()
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
            with TemporaryDirectory(prefix="codex-summary-") as working_directory:
                if self._runner:
                    result = self._runner(
                        command,
                        input=prompt,
                        env=codex_environment,
                        cwd=working_directory,
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=self._timeout_seconds,
                    )
                else:
                    result = _run_codex_process(
                        command,
                        prompt=prompt,
                        environment=codex_environment,
                        working_directory=working_directory,
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

        if result.returncode != 0:
            if on_provider_request is not None:
                on_provider_request(
                    {
                        "action": "finish",
                        "requestId": request_id,
                        "status": "failed",
                        "errorCode": f"codex-exit-{result.returncode}",
                        "usage": _extract_codex_usage(result.stdout or ""),
                    }
                )
            stdout_error = _extract_codex_error_message(result.stdout or "")
            if stdout_error:
                raise RuntimeError(stdout_error)

            stderr_text = (result.stderr or "").strip()
            raise RuntimeError(stderr_text or f"codex exited with status {result.returncode}")

        usage = _extract_codex_usage(result.stdout or "")
        try:
            summary_text = _extract_summary_text(result.stdout or "")
            if not summary_text:
                raise RuntimeError("codex returned no summary text")

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
