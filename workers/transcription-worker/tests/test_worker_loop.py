import time
import unittest

from transcription_worker.worker_loop import run_transcription_worker_iteration


class FakeClient:
    def __init__(self, claimed_job, job_statuses=None):
        self.claimed_job = claimed_job
        self.events = []
        self.heartbeats = []
        self.job_statuses = job_statuses or []

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

class FailOnceTranscriptEventClient(FakeClient):
    def __init__(self, claimed_job):
        super().__init__(claimed_job)
        self.failed = False

    def post_job_event(self, job_id, payload, lease_token=None):
        super().post_job_event(job_id, payload, lease_token=lease_token)
        if payload["type"] == "transcript-artifact-stored" and not self.failed:
            self.failed = True
            raise RuntimeError("control-plane callback failed")


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
        self.workflow_contexts = []

    def transcribe(
        self,
        local_audio_path,
        on_progress=None,
        on_transcription_usage=None,
        workflow_context=None,
    ):
        self.inputs.append(local_audio_path)
        self.workflow_contexts.append(workflow_context)
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

    def transcribe(
        self,
        local_audio_path,
        on_progress=None,
        on_transcription_usage=None,
        workflow_context=None,
    ):
        self.inputs.append(local_audio_path)
        self.workflow_contexts.append(workflow_context)
        time.sleep(self.delay_seconds)
        return self.transcript_result


class PartiallyMeteredFailingTranscriber(FakeTranscriber):
    def transcribe(
        self,
        local_audio_path,
        on_progress=None,
        on_transcription_usage=None,
        workflow_context=None,
    ):
        self.inputs.append(local_audio_path)
        self.workflow_contexts.append(workflow_context)
        on_transcription_usage({"audio_ms": 60_000})
        raise RuntimeError("later Azure upload failed")


class FakeTranscriberRegistry:
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


class RunTranscriptionWorkerIterationTests(unittest.TestCase):
    def test_returns_idle_when_no_job_is_available(self) -> None:
        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=FakeClient(None),
            downloader=FakeDownloader("ignored.wav"),
            media_preparer=FakeMediaPreparer("ignored.wav"),
            transcriber=FakeTranscriber({"language": "en", "segments": []}),
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
        media_preparer = FakeMediaPreparer()

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            media_preparer=media_preparer,
            transcriber=transcriber,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_abc"})
        self.assertEqual(downloader.downloaded[0]["storageKey"], "recordings/job_abc/meeting.webm")
        self.assertEqual(media_preparer.inputs, [("/tmp/job_abc.wav", "video/webm")])
        self.assertEqual(transcriber.inputs, ["/tmp/prepared.wav"])
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
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_fail"})
        self.assertEqual(client.events[0][0], "job_fail")
        self.assertEqual(client.events[0][1]["type"], "progress-updated")
        self.assertEqual(client.events[1][1]["type"], "progress-updated")
        self.assertEqual(client.events[2][1]["type"], "progress-updated")
        self.assertEqual(client.events[3][1]["type"], "transcription-failed")
        self.assertEqual(client.events[3][1]["failure"]["code"], "transcription-failed")

    def test_retries_the_exact_transcript_callback_instead_of_sending_failure(self) -> None:
        client = FailOnceTranscriptEventClient(
            {
                "id": "job_transcript_callback_fail",
                "leaseToken": "lease_transcript_callback_fail",
                "recordingArtifact": {
                    "storageKey": "recordings/job_transcript_callback_fail/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_transcript_callback_fail/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )
        transcriber = FakeTranscriber(
            {
                "language": "en",
                "segments": [{"start_ms": 0, "end_ms": 1_000, "text": "hello"}],
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_transcript_callback_fail.wav"),
            media_preparer=FakeMediaPreparer("/tmp/job_transcript_callback_fail.wav"),
            transcriber=transcriber,
        )

        self.assertEqual(
            result,
            {"kind": "processed", "job_id": "job_transcript_callback_fail"},
        )
        terminal_events = [event for event in client.events if event[1]["type"].endswith("stored")]
        self.assertEqual(len(terminal_events), 2)
        self.assertEqual(terminal_events[1], terminal_events[0])

    def test_reports_spent_azure_audio_usage_on_failure(self) -> None:
        client = FakeClient(
            {
                "id": "job_partial_azure_fail",
                "leaseToken": "lease_partial_azure_fail",
                "transcriptionProvider": "azure-openai-gpt-4o-transcribe",
                "recordingArtifact": {
                    "storageKey": "recordings/job_partial_azure_fail/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_partial_azure_fail/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )
        transcriber = PartiallyMeteredFailingTranscriber()

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_partial_azure_fail.wav"),
            media_preparer=FakeMediaPreparer("/tmp/job_partial_azure_fail.wav"),
            transcriber=transcriber,
            transcriber_registry=FakeTranscriberRegistry(
                {"azure-openai-gpt-4o-transcribe": transcriber}
            ),
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_partial_azure_fail"})
        self.assertEqual(client.events[-1][1]["type"], "transcription-failed")
        self.assertEqual(
            client.events[-1][1]["usage"],
            {"audioMs": 60_000},
        )

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
                {"id": "job_cancel", "state": "transcribing"},
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
            progress_updates=[
                {"processed_ms": 300000, "total_ms": 900000, "percent": 33},
                {"processed_ms": 300000, "total_ms": 900000, "percent": 33},
            ],
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            media_preparer=media_preparer,
            transcriber=transcriber,
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
                "azure-openai-gpt-4o-transcribe": azure_transcriber,
            }
        )
        client = FakeClient(
            {
                "id": "job_azure",
                "transcriptionProvider": "azure-openai-gpt-4o-transcribe",
                "submissionTemplateId": "sales",
                "transcriptionGlossary": ["舌片 = 蛇片", "條碼 = 調碼"],
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
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_azure"})
        self.assertEqual(registry.selected, ["azure-openai-gpt-4o-transcribe"])
        self.assertEqual(azure_transcriber.inputs, ["/tmp/job_azure.wav"])
        self.assertEqual(whisper_transcriber.inputs, [])
        self.assertEqual(
            azure_transcriber.workflow_contexts,
            [
                {
                    "template_id": "sales",
                    "glossary": ["舌片 = 蛇片", "條碼 = 調碼"],
                }
            ],
        )
        self.assertEqual(client.events[2][1]["processingMessage"], "Running Azure OpenAI transcription.")
        self.assertEqual(client.events[3][1]["transcriptArtifact"]["language"], "zh")

    def test_uses_qwen_with_full_evidence_callbacks(self) -> None:
        qwen_transcriber = FakeTranscriber(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 900, "text": "qwen transcript"}],
            }
        )
        registry = FakeTranscriberRegistry({"qwen3-asr-1.7b": qwen_transcriber})
        client = FakeClient(
            {
                "id": "job_qwen",
                "transcriptionProvider": "qwen3-asr-1.7b",
                "recordingArtifact": {
                    "storageKey": "recordings/job_qwen/meeting.wav",
                    "downloadUrl": "https://storage.example.test/recordings/job_qwen/meeting.wav",
                    "contentType": "audio/wav",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_qwen.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_qwen.wav"),
            transcriber=qwen_transcriber,
            transcriber_registry=registry,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_qwen"})
        self.assertEqual(registry.selected, ["qwen3-asr-1.7b"])
        self.assertEqual(
            client.events[2][1]["processingMessage"],
            "Running Qwen3-ASR transcription.",
        )
        self.assertEqual(
            qwen_transcriber.workflow_contexts,
            [{"template_id": "general", "glossary": []}],
        )

    def test_uses_mai_with_full_evidence_callbacks(self) -> None:
        mai_transcriber = FakeTranscriber(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 900, "text": "MAI transcript"}],
            }
        )
        registry = FakeTranscriberRegistry(
            {"azure-speech-mai-transcribe-1.5": mai_transcriber}
        )
        client = FakeClient(
            {
                "id": "job_mai",
                "transcriptionProvider": "azure-speech-mai-transcribe-1.5",
                "recordingArtifact": {
                    "storageKey": "recordings/job_mai/meeting.wav",
                    "downloadUrl": "https://storage.example.test/recordings/job_mai/meeting.wav",
                    "contentType": "audio/wav",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_mai.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_mai.wav"),
            transcriber=mai_transcriber,
            transcriber_registry=registry,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_mai"})
        self.assertEqual(registry.selected, ["azure-speech-mai-transcribe-1.5"])
        self.assertEqual(
            client.events[2][1]["processingMessage"],
            "Running Azure Speech MAI-Transcribe 1.5.",
        )
        self.assertEqual(
            mai_transcriber.workflow_contexts,
            [{"template_id": "general", "glossary": []}],
        )

    def test_rejects_a_latched_mai_model_that_differs_from_the_worker_model(self) -> None:
        mai_transcriber = FakeTranscriber(
            {
                "language": "zh",
                "segments": [{"start_ms": 0, "end_ms": 900, "text": "must not run"}],
            }
        )
        mai_transcriber.deployment = "mai-transcribe-1.5"
        client = FakeClient(
            {
                "id": "job_mai_model_mismatch",
                "transcriptionProvider": "azure-speech-mai-transcribe-1.5",
                "transcriptionModel": "wrong-model",
                "recordingArtifact": {
                    "storageKey": "recordings/job_mai_model_mismatch/meeting.wav",
                    "downloadUrl": "https://storage.example.test/meeting.wav",
                    "contentType": "audio/wav",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_mai_model_mismatch.wav"),
            media_preparer=FakeMediaPreparer(
                local_audio_path="/tmp/job_mai_model_mismatch.wav"
            ),
            transcriber=mai_transcriber,
            transcriber_registry=FakeTranscriberRegistry(
                {"azure-speech-mai-transcribe-1.5": mai_transcriber}
            ),
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_mai_model_mismatch"})
        self.assertEqual(mai_transcriber.inputs, [])
        self.assertIn("does not match", client.events[-1][1]["failure"]["message"])

    def test_posts_extended_transcript_segment_evidence_without_replacing_raw_text(self) -> None:
        transcriber = FakeTranscriber(
            {
                "language": "zh-Hant",
                "segments": [
                    {
                        "start_ms": 0,
                        "end_ms": 900,
                        "text": "需要黑電淨化器",
                        "raw_text": "需要黑電淨化器",
                        "display_text": "需要黑電淨化器",
                        "language": "zh-Hant",
                        "timing_source": "estimated",
                        "review_flags": [
                            {
                                "reason": "domain-term",
                                "original_text": "黑電淨化器",
                                "candidates": ["黑煙淨化器"],
                                "start_ms": 0,
                                "end_ms": 900,
                            }
                        ],
                    }
                ],
            }
        )
        client = FakeClient(
            {
                "id": "job_evidence",
                "transcriptionProvider": "azure-openai-gpt-4o-transcribe",
                "submissionTemplateId": "sales",
                "recordingArtifact": {
                    "storageKey": "recordings/job_evidence/meeting.webm",
                    "downloadUrl": "https://storage.example.test/recordings/job_evidence/meeting.webm",
                    "contentType": "video/webm",
                },
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=FakeDownloader("/tmp/job_evidence.wav"),
            media_preparer=FakeMediaPreparer(local_audio_path="/tmp/job_evidence.wav"),
            transcriber=transcriber,
            transcriber_registry=FakeTranscriberRegistry(
                {"azure-openai-gpt-4o-transcribe": transcriber}
            ),
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_evidence"})
        artifact = client.events[3][1]["transcriptArtifact"]
        self.assertEqual(artifact["schemaVersion"], 2)
        self.assertEqual(
            artifact["segments"][0],
            {
                "startMs": 0,
                "endMs": 900,
                "text": "需要黑電淨化器",
                "rawText": "需要黑電淨化器",
                "displayText": "需要黑電淨化器",
                "language": "zh-Hant",
                "timingSource": "estimated",
                "reviewFlags": [
                    {
                        "reason": "domain-term",
                        "originalText": "黑電淨化器",
                        "candidates": ["黑煙淨化器"],
                        "startMs": 0,
                        "endMs": 900,
                    }
                ],
            },
        )

if __name__ == "__main__":
    unittest.main()
