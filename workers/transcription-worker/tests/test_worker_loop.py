import unittest

from transcription_worker.worker_loop import run_transcription_worker_iteration


class FakeClient:
    def __init__(self, claimed_job, job_statuses=None):
        self.claimed_job = claimed_job
        self.events = []
        self.job_statuses = job_statuses or []

    def claim_next_job(self, worker_id):
        return self.claimed_job

    def post_job_event(self, job_id, payload):
        self.events.append((job_id, payload))

    def get_job(self, job_id):
        if self.job_statuses:
            return self.job_statuses.pop(0)
        return {"id": job_id, "state": "transcribing"}


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

    def summarize(self, transcript_result):
        self.inputs.append(transcript_result)
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
        self.assertEqual(summarizer.inputs[0]["segments"][0]["text"], "hello team")
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
        self.assertEqual(client.events[6][1]["type"], "progress-updated")
        self.assertEqual(client.events[6][1]["processingStage"], "generating-summary")
        self.assertEqual(client.events[7][1]["type"], "summary-artifact-stored")
        self.assertEqual(client.events[7][1]["summaryArtifact"]["model"], "gpt-5.3-codex-spark")
        self.assertEqual(client.events[7][1]["summaryArtifact"]["structured"]["actionItems"], ["send recap"])

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


if __name__ == "__main__":
    unittest.main()
