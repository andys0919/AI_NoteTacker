import time
import unittest

from transcription_worker.worker_loop import run_transcription_worker_iteration


class FakeClient:
    def __init__(self, claimed_job, job_statuses=None, summary_slot_results=None):
        self.claimed_job = claimed_job
        self.events = []
        self.heartbeats = []
        self.job_statuses = job_statuses or []
        self.summary_slot_results = summary_slot_results or [True]
        self.summary_slot_requests = []

    def claim_next_job(self, worker_id):
        return self.claimed_job

    def post_job_event(self, job_id, payload, lease_token=None):
        if lease_token:
            payload = {**payload, "leaseToken": lease_token}
        self.events.append((job_id, payload))

    def post_lease_heartbeat(self, job_id, stage, lease_token=None):
        self.heartbeats.append((job_id, stage, lease_token))

    def get_job(self, job_id):
        if self.job_statuses:
            return self.job_statuses.pop(0)
        return {"id": job_id, "state": "transcribing"}

    def claim_summary_slot(self, job_id, worker_id):
        self.summary_slot_requests.append((job_id, worker_id))
        if self.summary_slot_results:
            return self.summary_slot_results.pop(0)
        return True


class FakeDownloader:
    def __init__(self, local_path):
        self.local_path = local_path
        self.downloaded = []

    def download(self, artifact):
        self.downloaded.append(artifact)
        return self.local_path


class FakeTranscriber:
    def __init__(self, transcript_result=None, error=None, progress_updates=None):
        self.transcript_result = transcript_result
        self.error = error
        self.progress_updates = progress_updates or []
        self.inputs = []

    def transcribe(self, local_audio_path, on_progress=None):
        self.inputs.append(local_audio_path)
        if self.error:
            raise self.error
        if on_progress:
            for update in self.progress_updates:
                on_progress(update)
        return self.transcript_result


class SlowTranscriber(FakeTranscriber):
    def __init__(self, delay_seconds, transcript_result=None):
        super().__init__(transcript_result=transcript_result or {"language": "en", "segments": []})
        self.delay_seconds = delay_seconds

    def transcribe(self, local_audio_path, on_progress=None):
        self.inputs.append(local_audio_path)
        time.sleep(self.delay_seconds)
        return self.transcript_result


class FakeTranscriberRegistry:
    def __init__(self, providers):
        self.providers = providers
        self.selected = []

    def get(self, provider):
        self.selected.append(provider)
        return self.providers[provider]


class FakeSummarizerRegistry:
    def __init__(self, providers):
        self.providers = providers
        self.selected = []

    def get(self, provider):
        self.selected.append(provider)
        return self.providers[provider]


class FakeMediaPreparer:
    def __init__(self, local_audio_path="/tmp/prepared.wav"):
        self.local_audio_path = local_audio_path
        self.inputs = []

    def prepare(self, local_media_path, content_type):
        self.inputs.append((local_media_path, content_type))
        return {"local_audio_path": self.local_audio_path, "prepared": True}


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


class RunTranscriptionWorkerIterationTests(unittest.TestCase):
    def test_returns_idle_when_no_job_is_available(self) -> None:
        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=FakeClient(None),
            downloader=FakeDownloader("ignored.wav"),
            media_preparer=FakeMediaPreparer("ignored.wav"),
            transcriber=FakeTranscriber({"language": "en", "segments": []}),
            summarizer=None,
        )

        self.assertEqual(result, {"kind": "idle"})

    def test_downloads_recording_and_posts_transcript_artifact(self) -> None:
        client = FakeClient(
            {
                "id": "job_abc",
                "recordingArtifact": {
                    "storageKey": "recordings/job_abc/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_abc/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )
        downloader = FakeDownloader("/tmp/job_abc.wav")
        transcriber = FakeTranscriber(
            {
                "language": "en",
                "segments": [
                    {"start_ms": 0, "end_ms": 900, "text": "hello team"},
                ],
            },
            progress_updates=[
                {"processed_ms": 300000, "total_ms": 900000, "percent": 33},
                {"processed_ms": 600000, "total_ms": 900000, "percent": 66},
            ],
        )
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Short summary",
                "structured": {
                    "summary": "Short summary",
                    "key_points": ["hello team"],
                    "action_items": ["send recap"],
                    "decisions": ["ship beta"],
                    "risks": ["deadline risk"],
                    "open_questions": ["who owns rollout"],
                },
            }
        )
        media_preparer = FakeMediaPreparer()

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            media_preparer=media_preparer,
            transcriber=transcriber,
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_abc"})
        self.assertEqual(downloader.downloaded[0]["storageKey"], "recordings/job_abc/meeting.webm")
        self.assertEqual(media_preparer.inputs, [("/tmp/job_abc.wav", "video/webm")])
        self.assertEqual(transcriber.inputs, ["/tmp/prepared.wav"])
        self.assertEqual(summarizer.inputs, [])
        self.assertEqual(client.events[0][0], "job_abc")
        self.assertEqual(client.events[0][1]["type"], "progress-updated")
        self.assertEqual(client.events[0][1]["processingStage"], "preparing-media")
        self.assertEqual(client.events[1][1]["type"], "progress-updated")
        self.assertEqual(client.events[1][1]["processingStage"], "preparing-media")
        self.assertEqual(client.events[2][1]["type"], "progress-updated")
        self.assertEqual(client.events[2][1]["processingStage"], "transcribing-audio")
        self.assertEqual(client.events[3][1]["progressPercent"], 33)
        self.assertEqual(client.events[3][1]["progressProcessedMs"], 300000)
        self.assertEqual(client.events[4][1]["progressPercent"], 66)
        self.assertEqual(client.events[4][1]["progressProcessedMs"], 600000)
        self.assertEqual(client.events[5][1]["type"], "transcript-artifact-stored")
        self.assertEqual(len(client.events), 6)
        self.assertEqual(summarizer.summary_profiles, [])
        self.assertEqual(summarizer.model_overrides, [])

    def test_reports_transcription_failure_instead_of_crashing(self) -> None:
        client = FakeClient(
            {
                "id": "job_fail",
                "recordingArtifact": {
                    "storageKey": "recordings/job_fail/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_fail/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )
        downloader = FakeDownloader("/tmp/job_fail.wav")
        transcriber = FakeTranscriber(error=RuntimeError("decoder exploded"))
        media_preparer = FakeMediaPreparer(local_audio_path="/tmp/job_fail.wav")

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            media_preparer=media_preparer,
            transcriber=transcriber,
            summarizer=None,
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_fail"})
        self.assertEqual(client.events[0][0], "job_fail")
        self.assertEqual(client.events[0][1]["type"], "progress-updated")
        self.assertEqual(client.events[1][1]["type"], "progress-updated")
        self.assertEqual(client.events[2][1]["type"], "progress-updated")
        self.assertEqual(client.events[3][1]["type"], "transcription-failed")
        self.assertEqual(client.events[3][1]["failure"]["code"], "transcription-failed")

    def test_stops_posting_artifacts_when_the_job_is_cancelled_mid_transcription(self) -> None:
        client = FakeClient(
            {
                "id": "job_cancel",
                "recordingArtifact": {
                    "storageKey": "recordings/job_cancel/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_cancel/meeting.webm",
                    "contentType": "video/webm",
                },
            },
            job_statuses=[
                {
                    "id": "job_cancel",
                    "state": "failed",
                    "failureCode": "operator-cancel-requested",
                }
            ],
        )
        downloader = FakeDownloader("/tmp/job_cancel.wav")
        media_preparer = FakeMediaPreparer(local_audio_path="/tmp/job_cancel.wav")
        transcriber = FakeTranscriber(
            {
                "language": "en",
                "segments": [
                    {"start_ms": 0, "end_ms": 900, "text": "hello team"},
                ],
            },
            progress_updates=[{"processed_ms": 300000, "total_ms": 900000, "percent": 33}],
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            media_preparer=media_preparer,
            transcriber=transcriber,
            summarizer=None,
        )

        self.assertEqual(result, {"kind": "cancelled", "job_id": "job_cancel"})
        self.assertEqual(client.events[0][1]["type"], "progress-updated")
        self.assertEqual(client.events[1][1]["type"], "progress-updated")
        self.assertEqual(client.events[2][1]["type"], "progress-updated")
        self.assertEqual(client.events[3][1]["type"], "progress-updated")
        self.assertEqual(len(client.events), 4)

    def test_posts_transcription_lease_heartbeats_while_transcribing(self) -> None:
        client = FakeClient(
            {
                "id": "job_heartbeat",
                "leaseToken": "lease_transcription_heartbeat",
                "recordingArtifact": {
                    "storageKey": "recordings/job_heartbeat/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_heartbeat/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_heartbeat.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_heartbeat.wav"),
            transcriber=SlowTranscriber(delay_seconds=0.05),
            summarizer=None,
            heartbeat_interval_ms=10,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_heartbeat"})
        self.assertGreaterEqual(len(client.heartbeats), 2)
        self.assertEqual(
            client.heartbeats[0],
            ("job_heartbeat", "transcription", "lease_transcription_heartbeat"),
        )

    def test_uses_the_claimed_azure_provider_when_the_job_requests_it(self) -> None:
        azure_transcriber = FakeTranscriber(
            {
                "language": "zh",
                "segments": [
                    {"start_ms": 0, "end_ms": 900, "text": "azure transcript"},
                ],
            }
        )
        whisper_transcriber = FakeTranscriber(
            {
                "language": "en",
                "segments": [
                    {"start_ms": 0, "end_ms": 900, "text": "whisper transcript"},
                ],
            }
        )
        registry = FakeTranscriberRegistry(
            {
                "self-hosted-whisper": whisper_transcriber,
                "azure-openai-gpt-4o-mini-transcribe": azure_transcriber,
            }
        )
        client = FakeClient(
            {
                "id": "job_azure",
                "transcriptionProvider": "azure-openai-gpt-4o-mini-transcribe",
                "recordingArtifact": {
                    "storageKey": "recordings/job_azure/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_azure/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_azure.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_azure.wav"),
            transcriber=whisper_transcriber,
            transcriber_registry=registry,
            summarizer=None,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_azure"})
        self.assertEqual(registry.selected, ["azure-openai-gpt-4o-mini-transcribe"])
        self.assertEqual(azure_transcriber.inputs, ["/tmp/job_azure.wav"])
        self.assertEqual(whisper_transcriber.inputs, [])
        self.assertEqual(client.events[2][1]["processingMessage"], "Running Azure OpenAI transcription.")
        self.assertEqual(client.events[3][1]["transcriptArtifact"]["language"], "zh")

    def test_forwards_the_job_summary_profile_to_the_summarizer(self) -> None:
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Sales summary",
                "structured": {
                    "summary": "Sales summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        client = FakeClient(
            {
                "id": "job_sales",
                "summaryProfile": "sales",
                "recordingArtifact": {
                    "storageKey": "recordings/job_sales/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_sales/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_sales.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_sales.wav"),
            transcriber=FakeTranscriber(
                {
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 900, "text": "客戶希望四月上線"}],
                }
            ),
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_sales"})
        self.assertEqual(summarizer.summary_profiles, [])

    def test_forwards_the_claimed_cloud_summary_model_to_the_summarizer(self) -> None:
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.4-nano",
                "reasoning_effort": "cloud-default",
                "text": "Nano summary",
                "structured": {
                    "summary": "Nano summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        client = FakeClient(
            {
                "id": "job_model_override",
                "summaryProvider": "azure-openai",
                "summaryModel": "gpt-5.4-nano",
                "recordingArtifact": {
                    "storageKey": "recordings/job_model_override/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_model_override/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_model_override.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_model_override.wav"),
            transcriber=FakeTranscriber(
                {
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 900, "text": "模型切換測試"}],
                }
            ),
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_model_override"})
        self.assertEqual(summarizer.model_overrides, [])

    def test_ignores_the_claimed_summary_model_when_using_local_codex(self) -> None:
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Local summary",
                "structured": {
                    "summary": "Local summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        client = FakeClient(
            {
                "id": "job_local_summary_mode",
                "summaryProvider": "local-codex",
                "summaryModel": "gpt-5.4-nano",
                "recordingArtifact": {
                    "storageKey": "recordings/job_local_summary_mode/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_local_summary_mode/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_local_summary_mode.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_local_summary_mode.wav"),
            transcriber=FakeTranscriber(
                {
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 900, "text": "local codex"}],
                }
            ),
            summarizer=summarizer,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_local_summary_mode"})
        self.assertEqual(summarizer.model_overrides, [])

    def test_uses_the_claimed_summary_provider_and_posts_stage_usage(self) -> None:
        azure_summarizer = FakeSummarizer(
            {
                "model": "gpt-5.4-nano",
                "reasoning_effort": "cloud-default",
                "text": "Cloud summary",
                "structured": {
                    "summary": "Cloud summary",
                    "key_points": [],
                    "action_items": [],
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
        local_summarizer = FakeSummarizer(
            {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Local summary",
                "structured": {
                    "summary": "Local summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        summarizer_registry = FakeSummarizerRegistry(
            {
                "local-codex": local_summarizer,
                "azure-openai": azure_summarizer,
            }
        )
        client = FakeClient(
            {
                "id": "job_summary_provider",
                "transcriptionProvider": "azure-openai-gpt-4o-mini-transcribe",
                "summaryProvider": "azure-openai",
                "summaryModel": "gpt-5.4-nano",
                "recordingArtifact": {
                    "storageKey": "recordings/job_summary_provider/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_summary_provider/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )
        transcriber = FakeTranscriber(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 900, "text": "雲端摘要與用量測試"}],
                "usage": {"audio_ms": 900000},
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_summary_provider.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_summary_provider.wav"),
            transcriber=transcriber,
            summarizer=local_summarizer,
            summarizer_registry=summarizer_registry,
            sleep_fn=lambda _seconds: None,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_summary_provider"})
        self.assertEqual(summarizer_registry.selected, [])
        self.assertEqual(local_summarizer.inputs, [])
        self.assertEqual(azure_summarizer.model_overrides, [])
        self.assertEqual(client.summary_slot_requests, [])
        self.assertEqual(client.events[3][1]["transcriptArtifact"]["language"], "zh")
        self.assertEqual(client.events[3][1]["usage"], {"audioMs": 900000})

    def test_waits_until_a_summary_slot_is_available(self) -> None:
        summarizer = FakeSummarizer(
            {
                "model": "gpt-5.3-codex-spark",
                "reasoning_effort": "medium",
                "text": "Waited summary",
                "structured": {
                    "summary": "Waited summary",
                    "key_points": [],
                    "action_items": [],
                    "decisions": [],
                    "risks": [],
                    "open_questions": [],
                },
            }
        )
        client = FakeClient(
            {
                "id": "job_wait_summary_slot",
                "summaryProvider": "local-codex",
                "recordingArtifact": {
                    "storageKey": "recordings/job_wait_summary_slot/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_wait_summary_slot/meeting.webm",
                    "contentType": "video/webm",
                },
            },
            summary_slot_results=[False, True],
        )
        sleep_calls = []

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_wait_summary_slot.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_wait_summary_slot.wav"),
            transcriber=FakeTranscriber(
                {
                    "language": "zh",
                    "segments": [{"start_ms": 0, "end_ms": 900, "text": "summary slot wait"}],
                }
            ),
            summarizer=summarizer,
            sleep_fn=lambda seconds: sleep_calls.append(seconds),
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_wait_summary_slot"})
        self.assertEqual(client.summary_slot_requests, [])
        self.assertEqual(sleep_calls, [])


if __name__ == "__main__":
    unittest.main()
