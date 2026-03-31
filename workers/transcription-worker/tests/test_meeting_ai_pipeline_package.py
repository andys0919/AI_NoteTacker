import unittest

from meeting_ai_pipeline.pipeline import run_meeting_ai_pipeline


class _FakeDownloader:
    def __init__(self):
        self.artifacts = []

    def download(self, artifact):
        self.artifacts.append(artifact)
        return "/tmp/example.wav"


class _FakeTranscriber:
    def __init__(self):
        self.inputs = []

    def transcribe(self, local_audio_path):
        self.inputs.append(local_audio_path)
        return {
            "language": "en",
            "segments": [
                {"start_ms": 0, "end_ms": 1000, "text": "hello team"},
            ],
        }


class _FakeSummarizer:
    def __init__(self):
        self.inputs = []

    def summarize(self, transcript_result):
        self.inputs.append(transcript_result)
        return {
            "model": "gpt-5.3-codex-spark",
            "reasoning_effort": "medium",
            "text": "Short summary",
        }


class MeetingAiPipelinePackageTests(unittest.TestCase):
    def test_runs_download_transcription_and_summary_through_shared_package(self) -> None:
        downloader = _FakeDownloader()
        transcriber = _FakeTranscriber()
        summarizer = _FakeSummarizer()

        result = run_meeting_ai_pipeline(
            recording_artifact={
                "storageKey": "recordings/job_abc/meeting.webm",
                "downloadUrl": "https://storage.example.test/recordings/job_abc/meeting.webm",
                "contentType": "video/webm",
            },
            downloader=downloader,
            transcriber=transcriber,
            summarizer=summarizer,
        )

        self.assertEqual(downloader.artifacts[0]["storageKey"], "recordings/job_abc/meeting.webm")
        self.assertEqual(transcriber.inputs, ["/tmp/example.wav"])
        self.assertEqual(summarizer.inputs[0]["segments"][0]["text"], "hello team")
        self.assertEqual(result["transcript"]["language"], "en")
        self.assertEqual(result["summary"]["text"], "Short summary")


if __name__ == "__main__":
    unittest.main()
