from transcription_worker.azure_openai_responses import (
    AzureOpenAiResponsesHttpError,
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


def _raise_with_valid_usage(
    error: Exception,
    payload: dict,
    provider_request_count: int,
    unmetered_request_count: int,
) -> None:
    try:
        usage = extract_token_usage(payload)
    except Exception:
        raise error

    raise AzureOpenAiSummaryError(
        str(error),
        {
            **usage,
            "provider_request_count": provider_request_count,
            "unmetered_request_count": unmetered_request_count,
        },
    ) from error


class AzureOpenAiTranscriptSummarizer:
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        reasoning_effort: str = "high",
        timeout_seconds: int = 300,
        urlopen=None,
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._reasoning_effort = reasoning_effort
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

        request_options = dict(
            endpoint=self._endpoint,
            api_key=self._api_key,
            model=model,
            instructions="You are a precise meeting summarizer. Return JSON only.",
            user_input=prompt,
            reasoning_effort=self._reasoning_effort,
            timeout_seconds=self._timeout_seconds,
            urlopen=self._urlopen,
        )
        provider_request_count = 1
        unmetered_request_count = 0

        try:
            payload = request_response(**request_options)
        except AzureOpenAiResponsesHttpError as error:
            if error.status_code != 400:
                raise AzureOpenAiSummaryError(
                    str(error),
                    {
                        "input_tokens": 0,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 0,
                        "provider_request_count": 1,
                        "unmetered_request_count": 1,
                    },
                ) from error

            provider_request_count = 2
            unmetered_request_count = 1
            try:
                payload = request_response(**request_options)
            except Exception as retry_error:
                raise AzureOpenAiSummaryError(
                    f"Azure OpenAI summary failed after one HTTP 400 retry: {retry_error}",
                    {
                        "input_tokens": 0,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 0,
                        "provider_request_count": 2,
                        "unmetered_request_count": 2,
                    },
                ) from retry_error

        try:
            summary_text = extract_output_text(payload)
        except Exception as error:
            _raise_with_valid_usage(
                error,
                payload,
                provider_request_count,
                unmetered_request_count,
            )

        if not summary_text:
            _raise_with_valid_usage(
                RuntimeError("azure openai returned no summary text"),
                payload,
                provider_request_count,
                unmetered_request_count,
            )

        try:
            summary_payload = coerce_summary_payload(
                summary_text,
                provider_label="azure openai",
                require_complete_schema=True,
            )
        except Exception as error:
            _raise_with_valid_usage(
                error,
                payload,
                provider_request_count,
                unmetered_request_count,
            )

        try:
            usage = extract_token_usage(payload)
        except Exception as error:
            raise AzureOpenAiSummaryError(
                str(error),
                {
                    "input_tokens": 0,
                    "cached_input_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_output_tokens": 0,
                    "total_tokens": 0,
                    "provider_request_count": provider_request_count,
                    "unmetered_request_count": provider_request_count,
                },
            ) from error

        return {
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
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "cached_prompt_tokens": usage.get("cached_input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "reasoning_completion_tokens": usage.get("reasoning_output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "provider_request_count": provider_request_count,
                "unmetered_request_count": unmetered_request_count,
            },
        }
