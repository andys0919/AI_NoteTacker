import json
from urllib import error as urllib_error, request


class AzureOpenAiResponsesHttpError(RuntimeError):
    def __init__(self, status_code: int, response_body: str) -> None:
        self.status_code = status_code
        self.response_body = response_body
        suffix = f": {response_body}" if response_body else ""
        super().__init__(
            f"Azure OpenAI Responses request failed with status {status_code}{suffix}"
        )


def request_response(
    endpoint: str,
    api_key: str,
    model: str,
    user_input: str,
    instructions: str | None = None,
    reasoning_effort: str | None = None,
    timeout_seconds: int = 300,
    urlopen=None,
) -> dict:
    """POST to the Azure OpenAI Responses API (`/openai/v1/responses`) and return
    the parsed JSON payload.

    The Responses API takes `input` (and optional `instructions`) instead of the
    chat `messages` array, and authenticates with the `api-key` header.
    """
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
    body = json.dumps(body_dict).encode("utf-8")

    http_request = request.Request(
        endpoint,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "api-key": api_key,
        },
        data=body,
    )

    try:
        with urlopen(http_request, timeout=timeout_seconds) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace").strip()
        if api_key:
            response_body = response_body.replace(api_key, "[REDACTED]")
        raise AzureOpenAiResponsesHttpError(error.code, response_body) from error


def extract_output_text(payload: dict) -> str:
    """Return the assistant text from a completed Responses API payload.

    The `output` array interleaves a `reasoning` item with the assistant
    `message`; only the message's `output_text` content carries the answer, so we
    skip everything else. Raw Azure Responses payloads do not include the SDK-only
    top-level `output_text` convenience field, so we reconstruct it here.
    """
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
            if chunk.get("type") == "output_text":
                text = chunk.get("text")
                if isinstance(text, str):
                    parts.append(text)
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
    reasoning_output_tokens = output_details["reasoning_tokens"]
    if any(
        type(value) is not int or value < 0
        for value in (cached_input_tokens, reasoning_output_tokens)
    ):
        raise RuntimeError("azure openai response has invalid token usage details")
    if (
        cached_input_tokens > usage["input_tokens"]
        or reasoning_output_tokens > usage["output_tokens"]
    ):
        raise RuntimeError("azure openai response has inconsistent token usage details")

    return {
        "input_tokens": usage["input_tokens"],
        "cached_input_tokens": cached_input_tokens,
        "output_tokens": usage["output_tokens"],
        "reasoning_output_tokens": reasoning_output_tokens,
        "total_tokens": usage["total_tokens"],
    }
