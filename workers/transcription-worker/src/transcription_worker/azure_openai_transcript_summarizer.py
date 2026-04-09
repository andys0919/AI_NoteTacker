import json
from urllib import request

from transcription_worker.codex_transcript_summarizer import (
    _build_summary_prompt,
    _coerce_summary_payload,
    _render_summary_markdown,
)


class AzureOpenAiTranscriptSummarizer:
    def __init__(self, endpoint: str, api_key: str, model: str, urlopen=None) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._model = model
        self._urlopen = urlopen or request.urlopen

    def summarize(
        self,
        transcript_result: dict,
        summary_profile: str = "general",
        model_override: str | None = None,
    ) -> dict:
        prompt = _build_summary_prompt(transcript_result, summary_profile=summary_profile)
        model = model_override or self._model
        body = json.dumps(
            {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a precise meeting summarizer. Return JSON only.",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
            }
        ).encode("utf-8")

        http_request = request.Request(
            self._endpoint,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "api-key": self._api_key,
            },
            data=body,
        )

        with self._urlopen(http_request) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))

        summary_text = (
            payload.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        )

        if not summary_text:
            raise RuntimeError("azure openai returned no summary text")

        summary_payload = _coerce_summary_payload(summary_text)

        return {
            "model": model,
            "reasoning_effort": "cloud-default",
            "text": _render_summary_markdown(summary_payload),
            "structured": {
                "summary": summary_payload["summary"],
                "key_points": summary_payload["key_points"],
                "action_items": summary_payload["action_items"],
                "decisions": summary_payload["decisions"],
                "risks": summary_payload["risks"],
                "open_questions": summary_payload["open_questions"],
            },
            "usage": {
                "prompt_tokens": payload.get("usage", {}).get("prompt_tokens", 0),
                "completion_tokens": payload.get("usage", {}).get("completion_tokens", 0),
                "total_tokens": payload.get("usage", {}).get("total_tokens", 0),
            },
        }
