from transcription_worker.azure_openai_responses import (
    extract_output_text,
    extract_token_usage,
    request_response,
)
from transcription_worker.transcript_summary import (
    build_summary_prompt,
    coerce_summary_payload,
    render_summary_markdown,
)


class AzureOpenAiSummaryError(RuntimeError):
    def __init__(self, message: str, usage: dict[str, int]) -> None:
        super().__init__(message)
        self.usage = usage


def _raise_with_valid_usage(error: Exception, payload: dict) -> None:
    try:
        usage = extract_token_usage(payload)
    except Exception:
        raise error

    raise AzureOpenAiSummaryError(str(error), usage) from error


class AzureOpenAiTranscriptSummarizer:
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        timeout_seconds: int = 300,
        urlopen=None,
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._urlopen = urlopen

    def summarize(
        self,
        transcript_result: dict,
        summary_profile: str = "general",
        model_override: str | None = None,
    ) -> dict:
        prompt = build_summary_prompt(transcript_result, summary_profile=summary_profile)
        model = model_override or self._model

        payload = request_response(
            endpoint=self._endpoint,
            api_key=self._api_key,
            model=model,
            instructions="You are a precise meeting summarizer. Return JSON only.",
            user_input=prompt,
            timeout_seconds=self._timeout_seconds,
            urlopen=self._urlopen,
        )

        try:
            summary_text = extract_output_text(payload)
        except Exception as error:
            _raise_with_valid_usage(error, payload)

        if not summary_text:
            _raise_with_valid_usage(
                RuntimeError("azure openai returned no summary text"),
                payload,
            )

        try:
            summary_payload = coerce_summary_payload(
                summary_text,
                provider_label="azure openai",
                require_complete_schema=True,
            )
        except Exception as error:
            _raise_with_valid_usage(error, payload)

        usage = extract_token_usage(payload)

        return {
            "model": model,
            "reasoning_effort": "cloud-default",
            "text": render_summary_markdown(summary_payload),
            "structured": {
                "summary": summary_payload["summary"],
                "key_points": summary_payload["key_points"],
                "action_items": summary_payload["action_items"],
                "decisions": summary_payload["decisions"],
                "risks": summary_payload["risks"],
                "open_questions": summary_payload["open_questions"],
            },
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "cached_prompt_tokens": usage.get("cached_input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "reasoning_completion_tokens": usage.get("reasoning_output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            },
        }
