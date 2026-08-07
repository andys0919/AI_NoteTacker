import time
import unittest

from transcription_worker.azure_openai_transcript_summarizer import AzureOpenAiSummaryError
from transcription_worker.summary_worker_loop import run_summary_worker_iteration


class FakeSummaryClient:
    def __init__(self, claimed_job, fallback_reserved=True):
        self.claimed_job = claimed_job
        self.fallback_reserved = fallback_reserved
        self.fallback_reservations = []
        self.events = []
        self.heartbeats = []
        self.provider_request_starts = []
        self.provider_request_finishes = []
        self.codex_usage_reports = []

    def claim_next_summary_job(self, worker_id, codex_usage=None):
        self.codex_usage_reports.append(codex_usage)
        return self.claimed_job

    def post_job_event(self, job_id, payload, lease_token=None):
        if lease_token:
            payload = {**payload, "leaseToken": lease_token}
        self.events.append((job_id, payload))

    def reserve_summary_fallback(self, job_id, lease_token):
        self.fallback_reservations.append((job_id, lease_token))
        return self.fallback_reserved

    def post_lease_heartbeat(self, job_id, stage, lease_token=None):
        self.heartbeats.append((job_id, stage, lease_token))

    def start_provider_request(self, job_id, request_id, **payload):
        self.provider_request_starts.append((job_id, request_id, payload))
        return {"created": True}

    def finish_provider_request(self, job_id, request_id, **payload):
        self.provider_request_finishes.append((job_id, request_id, payload))
        return {}


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

    def summarize(
        self,
        transcript_result,
        summary_profile="general",
        model_override=None,
        on_provider_request=None,
    ):
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

    def summarize(
        self,
        transcript_result,
        summary_profile="general",
        model_override=None,
        on_provider_request=None,
    ):
        self.inputs.append(transcript_result)
        self.summary_profiles.append(summary_profile)
        self.model_overrides.append(model_override)
        time.sleep(self.delay_seconds)
        return self.summary_result


class AuditedSummarizer(FakeSummarizer):
    def summarize(
        self,
        transcript_result,
        summary_profile="general",
        model_override=None,
        on_provider_request=None,
    ):
        on_provider_request(
            {
                "action": "start",
                "requestId": "request-summary-worker-1",
                "provider": "local-codex",
                "model": model_override,
                "operation": "summary",
            }
        )
        on_provider_request(
            {
                "action": "finish",
                "requestId": "request-summary-worker-1",
                "status": "succeeded",
                "usage": {
                    "inputTokens": 100,
                    "cachedInputTokens": 20,
                    "outputTokens": 30,
                    "reasoningOutputTokens": 5,
                    "totalTokens": 130,
                },
            }
        )
        return super().summarize(
            transcript_result,
            summary_profile=summary_profile,
            model_override=model_override,
            on_provider_request=on_provider_request,
        )


class RunSummaryWorkerIterationTests(unittest.TestCase):
    def test_returns_idle_when_no_summary_job_is_available(self) -> None:
        client = FakeSummaryClient(None)
        codex_usage = {
            "status": "available",
            "usedPercent": 12,
            "windowDurationMins": 10_080,
            "resetsAt": 1_786_680_000,
            "checkedAt": "2026-08-07T04:00:00+00:00",
        }
        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=FakeSummarizer(),
            codex_usage=codex_usage,
        )

        self.assertEqual(result, {"kind": "idle"})
        self.assertEqual(client.codex_usage_reports, [codex_usage])

    def test_claims_summary_work_and_posts_summary_artifact(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary",
                "leaseToken": "lease_summary_1",
                "summaryProfile": "sales",
                "summaryProvider": "local-codex",
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
                    "title": "客戶導入時程",
                    "summary": "Sales summary",
                    "topics": [
                        {
                            "title": "導入時程",
                            "status": "mixed",
                            "subtopics": [
                                {
                                    "title": "目標日期",
                                    "details": ["四月為目標", "正式日期待確認"],
                                }
                            ],
                            "points": ["四月為目標", "正式日期待確認"],
                            "conclusion": "目標已提出，日期待確認。",
                        }
                    ],
                    "follow_up_groups": [
                        {
                            "title": "商務交付",
                            "items": ["寄正式報價"],
                        }
                    ],
                    "analysis_notes": ["正式日期仍是執行依賴。"],
                    "key_points": ["客戶希望四月上線"],
                    "action_items": ["寄正式報價"],
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

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary"})
        self.assertEqual(summarizer.summary_profiles, ["sales"])
        self.assertEqual(summarizer.model_overrides, ["gpt-5.4-nano"])
        self.assertEqual(client.events[0][1]["type"], "summary-artifact-stored")
        self.assertEqual(client.events[0][1]["actualProvider"], "local-codex")
        self.assertEqual(client.events[0][1]["leaseToken"], "lease_summary_1")
        self.assertEqual(
            client.events[0][1]["summaryArtifact"]["structured"]["topics"][0]["status"],
            "mixed",
        )
        self.assertEqual(
            client.events[0][1]["summaryArtifact"]["structured"]["followUpGroups"][0][
                "title"
            ],
            "商務交付",
        )
        self.assertEqual(
            client.events[0][1]["summaryArtifact"]["structured"]["analysisNotes"],
            ["正式日期仍是執行依賴。"],
        )
        self.assertNotIn("usage", client.events[0][1])

    def test_tracks_local_codex_subscription_request_before_terminal_callback(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_audited",
                "leaseToken": "lease_summary_audited",
                "summaryModel": "gpt-5.6-luna",
                "transcriptArtifact": {
                    "language": "zh",
                    "segments": [{"startMs": 0, "endMs": 1_000, "text": "摘要"}],
                },
            }
        )
        summarizer = AuditedSummarizer(
            {
                "model": "gpt-5.6-luna",
                "reasoning_effort": "max",
                "text": "Audited summary",
                "structured": {
                    "summary": "Audited summary",
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

        self.assertEqual(
            result, {"kind": "processed", "job_id": "job_summary_audited"}
        )
        self.assertEqual(
            client.provider_request_starts[0][2]["provider"], "local-codex"
        )
        self.assertEqual(
            client.provider_request_finishes[0][2]["usage"]["totalTokens"], 130
        )
        self.assertEqual(
            client.events[0][1]["requestAuditIds"], ["request-summary-worker-1"]
        )

    def test_uses_azure_once_when_structured_preflight_reports_exhaustion(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_quota",
                "leaseToken": "lease_summary_quota",
                "summaryModel": "gpt-5.6-luna",
                "transcriptArtifact": {
                    "language": "zh",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "額度測試"}],
                },
            }
        )
        local = FakeSummarizer(error=RuntimeError("local should not run"))
        azure = FakeSummarizer(
            {
                "model": "gpt-5.6-luna",
                "reasoning_effort": "max",
                "text": "Azure fallback summary",
                "structured": {
                    "summary": "Azure fallback summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
                "usage": {
                    "prompt_tokens": 10,
                    "cached_prompt_tokens": 2,
                    "cache_write_prompt_tokens": 1,
                    "completion_tokens": 5,
                    "reasoning_completion_tokens": 1,
                    "total_tokens": 15,
                    "provider_request_count": 1,
                    "unmetered_request_count": 0,
                },
            }
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=local,
            azure_fallback_summarizer=azure,
            quota_is_exhausted=lambda: True,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary_quota"})
        self.assertEqual(local.inputs, [])
        self.assertEqual(len(azure.inputs), 1)
        self.assertEqual(
            client.fallback_reservations,
            [("job_summary_quota", "lease_summary_quota")],
        )
        self.assertEqual(azure.model_overrides, ["gpt-5.6-luna"])
        self.assertEqual(client.events[0][1]["actualProvider"], "azure-openai")
        self.assertEqual(client.events[0][1]["usage"]["providerRequestCount"], 1)
        self.assertEqual(client.events[0][1]["usage"]["cacheWritePromptTokens"], 1)

    def test_does_not_fall_back_after_a_generic_local_failure(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_quota_race",
                "leaseToken": "lease_summary_quota_race",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "quota race"}],
                },
            }
        )
        local = FakeSummarizer(error=RuntimeError("turn failed"))
        azure = FakeSummarizer(
            {
                "model": "gpt-5.6-luna",
                "reasoning_effort": "max",
                "text": "Fallback",
                "structured": {
                    "summary": "Fallback",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        quota_checks = []

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=local,
            azure_fallback_summarizer=azure,
            quota_is_exhausted=lambda: quota_checks.append(False) or False,
        )

        self.assertEqual(
            result, {"kind": "failed", "job_id": "job_summary_quota_race"}
        )
        self.assertEqual(len(local.inputs), 1)
        self.assertEqual(azure.inputs, [])
        self.assertEqual(len(quota_checks), 1)
        self.assertEqual(client.events[0][1]["actualProvider"], "local-codex")

    def test_does_not_repeat_an_already_reserved_azure_fallback(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_reclaimed",
                "leaseToken": "lease_summary_reclaimed",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "retry"}],
                },
            },
            fallback_reserved=False,
        )
        azure = FakeSummarizer()

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=FakeSummarizer(),
            azure_fallback_summarizer=azure,
            quota_is_exhausted=lambda: True,
        )

        self.assertEqual(
            result, {"kind": "failed", "job_id": "job_summary_reclaimed"}
        )
        self.assertEqual(azure.inputs, [])
        self.assertEqual(client.events[0][1]["actualProvider"], "local-codex")

    def test_reports_an_unmetered_failed_azure_fallback(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_azure_failure",
                "leaseToken": "lease_summary_azure_failure",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "failure"}],
                },
            }
        )
        azure_error = AzureOpenAiSummaryError(
            "Azure request failed",
            {
                "prompt_tokens": 0,
                "cached_prompt_tokens": 0,
                "completion_tokens": 0,
                "reasoning_completion_tokens": 0,
                "total_tokens": 0,
                "provider_request_count": 1,
                "unmetered_request_count": 1,
            },
        )

        class AuditedAzureFailure(FakeSummarizer):
            def summarize(self, *args, on_provider_request=None, **kwargs):
                on_provider_request(
                    {
                        "action": "start",
                        "requestId": "request-azure-summary-failed",
                        "provider": "azure-openai",
                        "model": "gpt-5.6-luna",
                        "operation": "summary",
                    }
                )
                on_provider_request(
                    {
                        "action": "finish",
                        "requestId": "request-azure-summary-failed",
                        "status": "failed",
                        "errorCode": "TimeoutError",
                    }
                )
                raise self.error

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=FakeSummarizer(),
            azure_fallback_summarizer=AuditedAzureFailure(error=azure_error),
            quota_is_exhausted=lambda: True,
        )

        self.assertEqual(
            result, {"kind": "failed", "job_id": "job_summary_azure_failure"}
        )
        self.assertEqual(client.events[0][1]["actualProvider"], "azure-openai")
        self.assertEqual(
            client.events[0][1]["requestAuditIds"],
            ["request-azure-summary-failed"],
        )
        self.assertEqual(client.events[0][1]["usage"]["providerRequestCount"], 1)
        self.assertEqual(client.events[0][1]["usage"]["unmeteredRequestCount"], 1)

    def test_omits_azure_attribution_when_fallback_fails_before_request_audit(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_azure_preflight_failure",
                "leaseToken": "lease_summary_azure_preflight_failure",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "failure"}],
                },
            }
        )
        error = AzureOpenAiSummaryError(
            "request audit unavailable",
            {
                "prompt_tokens": 0,
                "cached_prompt_tokens": 0,
                "completion_tokens": 0,
                "reasoning_completion_tokens": 0,
                "total_tokens": 0,
                "provider_request_count": 1,
                "unmetered_request_count": 1,
            },
        )

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=FakeSummarizer(),
            azure_fallback_summarizer=FakeSummarizer(error=error),
            quota_is_exhausted=lambda: True,
        )

        self.assertEqual(
            result,
            {"kind": "failed", "job_id": "job_summary_azure_preflight_failure"},
        )
        self.assertNotIn("actualProvider", client.events[0][1])
        self.assertNotIn("usage", client.events[0][1])
        self.assertNotIn("requestAuditIds", client.events[0][1])

    def test_does_not_fall_back_for_a_generic_local_failure(self) -> None:
        client = FakeSummaryClient(
            {
                "id": "job_summary_generic_failure",
                "leaseToken": "lease_summary_generic_failure",
                "transcriptArtifact": {
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 1000, "text": "failure"}],
                },
            }
        )
        local = FakeSummarizer(error=RuntimeError("authentication failed"))
        azure = FakeSummarizer()
        quota_checks = []

        result = run_summary_worker_iteration(
            worker_id="summary-alpha",
            client=client,
            summarizer=local,
            azure_fallback_summarizer=azure,
            quota_is_exhausted=lambda: quota_checks.append(False) or False,
        )

        self.assertEqual(
            result, {"kind": "failed", "job_id": "job_summary_generic_failure"}
        )
        self.assertEqual(len(quota_checks), 1)
        self.assertEqual(azure.inputs, [])
        self.assertEqual(client.events[0][1]["actualProvider"], "local-codex")

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
                            "speaker": "Speaker A",
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
        self.assertEqual(
            summarizer.inputs[0]["segments"][0]["speaker"],
            "Speaker A",
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
