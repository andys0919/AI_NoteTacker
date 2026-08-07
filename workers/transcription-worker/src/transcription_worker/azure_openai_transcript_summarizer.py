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


def _summary_usage(usage: dict[str, int] | None = None) -> dict[str, int]:
    usage = usage or {}
    result = {
        "prompt_tokens": usage.get("input_tokens", 0),
        "cached_prompt_tokens": usage.get("cached_input_tokens", 0),
        "completion_tokens": usage.get("output_tokens", 0),
        "reasoning_completion_tokens": usage.get("reasoning_output_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
        "provider_request_count": 1,
        "unmetered_request_count": 0 if usage else 1,
    }
    if "cache_write_tokens" in usage:
        result["cache_write_prompt_tokens"] = usage["cache_write_tokens"]
    return result


class AzureOpenAiSummaryError(RuntimeError):
    def __init__(self, message: str, usage: dict[str, int] | None) -> None:
        super().__init__(message)
        self.usage = usage


def _raise_with_usage(error: Exception, payload: dict) -> None:
    try:
        usage = _summary_usage(extract_token_usage(payload))
    except Exception:
        usage = _summary_usage()
    raise AzureOpenAiSummaryError(str(error), usage) from error


class AzureOpenAiTranscriptSummarizer:
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        reasoning_effort: str = "max",
        timeout_seconds: int = 900,
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
        on_provider_request=None,
    ) -> dict:
        model = model_override or self._model
        validated = {}
        provider_request_started = False

        def report_provider_request(update):
            nonlocal provider_request_started
            if update["action"] == "start":
                if on_provider_request is not None:
                    on_provider_request(update)
                provider_request_started = True
            elif on_provider_request is not None:
                on_provider_request(update)

        def validate_response(payload):
            try:
                summary_text = extract_output_text(payload)
                if not summary_text:
                    raise RuntimeError("azure openai returned no summary text")
                validated["summary_payload"] = coerce_summary_payload(
                    summary_text,
                    provider_label="azure openai",
                    require_complete_schema=True,
                )
                validated["usage"] = _summary_usage(extract_token_usage(payload))
            except Exception as error:
                _raise_with_usage(error, payload)

        try:
            request_response(
                endpoint=self._endpoint,
                api_key=self._api_key,
                model=model,
                instructions="You are a precise meeting summarizer. Return JSON only.",
                user_input=build_summary_prompt(
                    transcript_result, summary_profile=summary_profile
                ),
                reasoning_effort=self._reasoning_effort,
                timeout_seconds=self._timeout_seconds,
                urlopen=self._urlopen,
                on_provider_request=report_provider_request,
                validate_response=validate_response,
            )
        except AzureOpenAiSummaryError:
            raise
        except Exception as error:
            usage = _summary_usage() if provider_request_started else None
            raise AzureOpenAiSummaryError(str(error), usage) from error

        summary_payload = validated["summary_payload"]
        usage = validated["usage"]

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
            "usage": usage,
        }
