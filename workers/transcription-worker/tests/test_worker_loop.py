import unittest

from transcription_worker.worker_loop import run_transcription_worker_iteration


class FakeClient:
    def __init__(self, claimed_job):
        self.claimed_job = claimed_job
        self.events = []

    def claim_next_job(self, worker_id):
        return self.claimed_job

    def post_job_event(self, job_id, payload):
        self.events.append((job_id, payload))


class FakeDownloader:
    def __init__(self, local_path):
        self.local_path = local_path
        self.downloaded = []

    def download(self, artifact):
        self.downloaded.append(artifact)
        return self.local_path


class FakeTranscriber:
    def __init__(self, transcript_result=None, error=None):
        self.transcript_result = transcript_result
        self.error = error
        self.inputs = []

    def transcribe(self, local_audio_path):
        self.inputs.append(local_audio_path)
        if self.error:
            raise self.error
        return self.transcript_result


class RunTranscriptionWorkerIterationTests(unittest.TestCase):
    def test_returns_idle_when_no_job_is_available(self) -> None:
        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=FakeClient(None),
            downloader=FakeDownloader("ignored.wav"),
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
            }
        )

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            transcriber=transcriber,
        )

        self.assertEqual(result, {"kind": "processed", "job_id": "job_abc"})
        self.assertEqual(downloader.downloaded[0]["storageKey"], "recordings/job_abc/meeting.webm")
        self.assertEqual(transcriber.inputs, ["/tmp/job_abc.wav"])
        self.assertEqual(client.events[0][0], "job_abc")
        self.assertEqual(client.events[0][1]["type"], "transcript-artifact-stored")

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

        result = run_transcription_worker_iteration(
            worker_id="transcriber-alpha",
            client=client,
            downloader=downloader,
            transcriber=transcriber,
        )

        self.assertEqual(result, {"kind": "failed", "job_id": "job_fail"})
        self.assertEqual(client.events[0][0], "job_fail")
        self.assertEqual(client.events[0][1]["type"], "transcription-failed")
        self.assertEqual(client.events[0][1]["failure"]["code"], "transcription-failed")


if __name__ == "__main__":
    unittest.main()
