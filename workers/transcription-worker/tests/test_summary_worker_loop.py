import time
import unittest

from transcription_worker.summary_worker_loop import run_summary_worker_iteration


class FakeSummaryClient:
    def __init__(self, claimed_job):
        self.claimed_job = claimed_job
        self.events = []
        self.heartbeats = []

    def claim_next_summary_job(self, worker_id):
        return self.claimed_job

    def post_job_event(self, job_id, payload, lease_token=None):
        if lease_token:
            payload = {**payload, "leaseToken": lease_token}
        self.events.append((job_id, payload))

    def post_lease_heartbeat(self, job_id, stage, lease_token=None):
        self.heartbeats.append((job_id, stage, lease_token))


class FailOnceSummaryEventClient(FakeSummaryClient):
    def __init__(self, claimed_job):
        super().__init__(claimed_job)
        self.failed = False

    def post_job_event(self, job_id, payload, lease_token=None):
        super().post_job_event(job_id, payload, lease_token=lease_token)
        if not self.failed:
            self.failed = True
            raise RuntimeError("control-plane callback failed")


class FakeSummarizer:
    def __init__(self, summary_result=None, error=None):
        self.summary_result = summary_result
        self.error = error
        self.inputs = []
        self.summary_profiles = []
        self.model_overrides = []

    def summarize(self, transcript_result, summary_profile="general", model_override=None):
        self.inputs.append(transcript_result)
        self.summary_profiles.append(summary_profile)
        self.model_overrides.append(model_override)
        if self.error:
            raise self.error
        return self.summary_result


class SlowSummarizer(FakeSummarizer):
    def __init__(self, delay_seconds, summary_result=None):
        super().__init__(
            summary_result=summary_result
            or {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Slow summary",
                "structured": {
                    "summary": "Slow summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        self.delay_seconds = delay_seconds

    def summarize(self, transcript_result, summary_profile="general", model_override=None):
        self.inputs.append(transcript_result)
        self.summary_profiles.append(summary_profile)
        self.model_overrides.append(model_override)
        time.sleep(self.delay_seconds)
        return self.summary_result


class MeteredSummaryError(RuntimeError):
    def __init__(self, message, usage):
        super().__init__(message)
        self.usage = usage


class RunSummaryWorkerIterationTests(unittest.TestCase):
    def test_returns_idle_when_no_summary_job_is_available(self) -> None:
        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=FakeSummaryClient(None),
            summarizer=FakeSummarizer(),
        )

        self.assertEqual(result, {"kind": "idle"})

    def test_claims_summary_work_and_posts_summary_artifact(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary",
                "leaseToken": "lease_summary_1",
                "summaryProfile": "sales",
                "summaryProvider": "azure-openai",
                "summaryModel": "gpt-5.4-nano",
                "transcriptArtifact": {
                    "language": "zh",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "客戶希望四月上線"}],
                },
            }
        )
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.4-nano",
                "reasoning_effort": "cloud-default",
                "text": "Sales summary",
                "structured": {
                    "summary": "Sales summary",
                    "key_points": ["客戶希望四月上線"],
                    "action_items": ["寄正式報價"],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
                "usage": {
                    "prompt_tokens": 120,
                    "cached_prompt_tokens": 20,
                    "completion_tokens": 80,
                    "reasoning_completion_tokens": 30,
                    "total_tokens": 200,
                },
            }
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary"})
        self.assertEqual(summarizer.summary_profiles, ["sales"])
        self.assertEqual(summarizer.model_overrides, ["gpt-5.4-nano"])
        self.assertEqual(client.events[0][1]["type"], "summary-artifact-stored")
        self.assertEqual(client.events[0][1]["leaseToken"], "lease_summary_1")
        self.assertEqual(
            client.events[0][1]["usage"],
            {
                "promptTokens": 120,
                "cachedPromptTokens": 20,
                "completionTokens": 80,
                "reasoningCompletionTokens": 30,
                "totalTokens": 200,
            },
        )

    def test_passes_display_text_and_unresolved_review_flags_to_the_summarizer(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_evidence",
                "leaseToken": "lease_summary_evidence",
                "summaryProfile": "sales",
                "transcriptArtifact": {
                    "language": "zh-Hant",
                    "segments": [
                        {
                            "startMs": 0,
                            "endMs": 1000,
                            "text": "需要黑電淨化器",
                            "rawText": "需要黑電淨化器",
                            "displayText": "需要黑電淨化器",
                            "language": "zh-Hant",
                            "reviewFlags": [
                                {
                                    "reason": "domain-term",
                                    "originalText": "黑電淨化器",
                                    "candidates": ["黑煙淨化器"],
                                }
                            ],
                        }
                    ],
                },
            }
        )
        summarizer = FakeSummarizer(
            {
                "model": "test-model",
                "reasoning_effort": "medium",
                "text": "Summary",
                "structured": {
                    "summary": "Summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary_evidence"})
        self.assertEqual(
            summarizer.inputs[0]["segments"][0]["review_flags"],
            [
                {
                    "reason": "domain-term",
                    "original_text": "黑電淨化器",
                    "candidates": ["黑煙淨化器"],
                }
            ],
        )
        self.assertEqual(
            summarizer.inputs[0]["segments"][0]["text"],
            "需要黑電淨化器",
        )

    def test_posts_summary_failure_instead_of_crashing(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_fail",
                "leaseToken": "lease_summary_fail",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "hello"}],
                },
            }
        )
        summarizer = FakeSummarizer(error=RuntimeError("summary exploded"))

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_summary_fail"})
        self.assertEqual(client.events[0][1]["type"], "summary-failed")
        self.assertEqual(client.events[0][1]["leaseToken"], "lease_summary_fail")

    def test_posts_valid_provider_usage_with_a_failed_summary(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_metered_fail",
                "leaseToken": "lease_summary_metered_fail",
                "summaryProvider": "azure-openai",
                "summaryModel": "gpt-5.6-luna",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "hello"}],
                },
            }
        )
        summarizer = FakeSummarizer(
            error=MeteredSummaryError(
                "summary JSON was invalid",
                {
                    "input_tokens": 120,
                    "cached_input_tokens": 20,
                    "output_tokens": 80,
                    "reasoning_output_tokens": 30,
                    "total_tokens": 200,
                },
            )
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_summary_metered_fail"})
        self.assertEqual(
            client.events[0][1]["usage"],
            {
                "promptTokens": 120,
                "cachedPromptTokens": 20,
                "completionTokens": 80,
                "reasoningCompletionTokens": 30,
                "totalTokens": 200,
            },
        )

    def test_retries_the_exact_success_callback_instead_of_sending_summary_failed(self) -> None:
        client = FailOnceSummaryEventClient(
            {
                "id": "job_summary_callback_fail",
                "leaseToken": "lease_summary_callback_fail",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "hello"}],
                },
            }
        )
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.6-luna",
                "reasoning_effort": "cloud-default",
                "text": "Summary",
                "structured": {
                    "summary": "Summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
                "usage": {
                    "prompt_tokens": 1,
                    "cached_prompt_tokens": 0,
                    "completion_tokens": 1,
                    "reasoning_completion_tokens": 0,
                    "total_tokens": 2,
                },
            }
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary_callback_fail"})
        self.assertEqual(len(client.events), 2)
        self.assertEqual(client.events[0][1]["type"], "summary-artifact-stored")
        self.assertEqual(client.events[1], client.events[0])

    def test_posts_summary_lease_heartbeats_while_generating_summary(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_heartbeat",
                "leaseToken": "lease_summary_heartbeat",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "hello"}],
                },
            }
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=SlowSummarizer(delay_seconds=0.05),
            heartbeat_interval_ms=10,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary_heartbeat"})
        self.assertGreaterEqual(len(client.heartbeats), 2)
        self.assertEqual(
            client.heartbeats[0],
            ("job_summary_heartbeat", "summary", "lease_summary_heartbeat"),
        )


if __name__ == "__main__":
    unittest.main()
