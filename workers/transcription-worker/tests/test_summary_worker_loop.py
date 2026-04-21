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
                    "completion_tokens": 80,
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
        self.assertEqual(client.events[0][1]["usage"], {"promptTokens": 120, "completionTokens": 80, "totalTokens": 200})

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
