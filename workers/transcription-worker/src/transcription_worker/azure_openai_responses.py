import json
import uuid
from urllib import error as urllib_error, request


class AzureOpenAiResponsesHttpError(RuntimeError):
    def __init__(self, status_code: int, response_body: str) -> None:
        self.status_code = status_code
        self.response_body = response_body
        suffix = f": {response_body}" if response_body else ""
        super().__init__(
            f"Azure OpenAI Responses request failed with status {status_code}{suffix}"
        )


def _external_request_id(response) -> str | None:
    headers = getattr(response, "headers", None)
    get_header = getattr(headers, "get", None)
    if not callable(get_header):
        return None
    for name in ("x-request-id", "apim-request-id", "x-ms-request-id"):
        value = get_header(name)
        if value:
            return str(value)
    return None


def _provider_usage(payload: dict) -> dict | None:
    try:
        usage = extract_token_usage(payload)
    except Exception:
        return None
    result = {
        "inputTokens": usage["input_tokens"],
        "cachedInputTokens": usage["cached_input_tokens"],
        "outputTokens": usage["output_tokens"],
        "reasoningOutputTokens": usage["reasoning_output_tokens"],
        "totalTokens": usage["total_tokens"],
    }
    if "cache_write_tokens" in usage:
        result["cacheWriteInputTokens"] = usage["cache_write_tokens"]
    return result


def request_response(
    endpoint: str,
    api_key: str,
    model: str,
    user_input: str,
    instructions: str | None = None,
    reasoning_effort: str | None = None,
    timeout_seconds: int = 300,
    urlopen=None,
    on_provider_request=None,
    validate_response=None,
) -> dict:
    urlopen = urlopen or request.urlopen
    body_dict: dict[str, object] = {
        "model": model,
        "input": user_input,
        "store": False,
    }
    if instructions:
        body_dict["instructions"] = instructions
    if reasoning_effort:
        body_dict["reasoning"] = {"effort": reasoning_effort}

    http_request = request.Request(
        endpoint,
        method="POST",
        headers={"Content-Type": "application/json", "api-key": api_key},
        data=json.dumps(body_dict).encode("utf-8"),
    )
    request_id = uuid.uuid4().hex
    if on_provider_request is not None:
        on_provider_request(
            {
                "action": "start",
                "requestId": request_id,
                "provider": "azure-openai",
                "model": model,
                "operation": "summary",
            }
        )
    http_status = None
    provider_request_id = None

    try:
        with urlopen(http_request, timeout=timeout_seconds) as response:  # noqa: S310
            http_status = int(getattr(response, "status", 200))
            provider_request_id = _external_request_id(response)
            payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace").strip()
        if api_key:
            response_body = response_body.replace(api_key, "[REDACTED]")
        if on_provider_request is not None:
            on_provider_request(
                {
                    "action": "finish",
                    "requestId": request_id,
                    "status": "failed",
                    "providerRequestId": _external_request_id(error),
                    "httpStatus": error.code,
                    "errorCode": f"http-{error.code}",
                }
            )
        raise AzureOpenAiResponsesHttpError(error.code, response_body) from error
    except Exception as error:
        if on_provider_request is not None:
            on_provider_request(
                {
                    "action": "finish",
                    "requestId": request_id,
                    "status": "failed",
                    "providerRequestId": provider_request_id,
                    "httpStatus": http_status,
                    "errorCode": type(error).__name__,
                }
            )
        raise

    try:
        if validate_response is not None:
            validate_response(payload)
    except Exception:
        if on_provider_request is not None:
            on_provider_request(
                {
                    "action": "finish",
                    "requestId": request_id,
                    "status": "failed",
                    "providerRequestId": provider_request_id,
                    "httpStatus": http_status,
                    "errorCode": "response-validation-failed",
                    "usage": _provider_usage(payload),
                }
            )
        raise

    if on_provider_request is not None:
        completed = payload.get("status") == "completed"
        on_provider_request(
            {
                "action": "finish",
                "requestId": request_id,
                "status": "succeeded" if completed else "failed",
                "providerRequestId": provider_request_id,
                "httpStatus": http_status,
                **({} if completed else {"errorCode": "response-not-completed"}),
                "usage": _provider_usage(payload),
            }
        )
    return payload


def extract_output_text(payload: dict) -> str:
    status = payload.get("status")
    if status != "completed":
        details = payload.get("incomplete_details")
        reason = details.get("reason") if isinstance(details, dict) else None
        suffix = f": {reason.strip()}" if isinstance(reason, str) and reason.strip() else ""
        raise RuntimeError(
            f"azure openai response status is {status or 'missing'}{suffix}"
        )

    parts: list[str] = []
    for item in payload.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for chunk in item.get("content", []) or []:
            if chunk.get("type") == "output_text" and isinstance(chunk.get("text"), str):
                parts.append(chunk["text"])
    return "".join(parts).strip()


def extract_token_usage(payload: dict) -> dict[str, int]:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        raise RuntimeError("azure openai response is missing token usage")

    fields = ("input_tokens", "output_tokens", "total_tokens")
    if any(field not in usage for field in fields):
        raise RuntimeError("azure openai response has incomplete token usage")
    if any(type(usage[field]) is not int or usage[field] < 0 for field in fields):
        raise RuntimeError("azure openai response has invalid token usage")
    if usage["total_tokens"] != usage["input_tokens"] + usage["output_tokens"]:
        raise RuntimeError("azure openai response has inconsistent token usage")

    input_details = usage.get("input_tokens_details")
    output_details = usage.get("output_tokens_details")
    if not isinstance(input_details, dict) or not isinstance(output_details, dict):
        raise RuntimeError("azure openai response has invalid token usage details")
    if "cached_tokens" not in input_details or "reasoning_tokens" not in output_details:
        raise RuntimeError("azure openai response has incomplete token usage details")

    cached_input_tokens = input_details["cached_tokens"]
    cache_write_tokens = input_details.get("cache_write_tokens")
    reasoning_output_tokens = output_details["reasoning_tokens"]
    if any(
        type(value) is not int or value < 0
        for value in (cached_input_tokens, reasoning_output_tokens)
    ) or (
        cache_write_tokens is not None
        and (type(cache_write_tokens) is not int or cache_write_tokens < 0)
    ):
        raise RuntimeError("azure openai response has invalid token usage details")
    if (
        cached_input_tokens + (cache_write_tokens or 0) > usage["input_tokens"]
        or reasoning_output_tokens > usage["output_tokens"]
    ):
        raise RuntimeError("azure openai response has inconsistent token usage details")

    result = {
        "input_tokens": usage["input_tokens"],
        "cached_input_tokens": cached_input_tokens,
        "output_tokens": usage["output_tokens"],
        "reasoning_output_tokens": reasoning_output_tokens,
        "total_tokens": usage["total_tokens"],
    }
    if cache_write_tokens is not None:
        result["cache_write_tokens"] = cache_write_tokens
    return result
