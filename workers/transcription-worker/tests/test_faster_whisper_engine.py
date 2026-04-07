import unittest

from transcription_worker.faster_whisper_engine import FasterWhisperTranscriber


class _FakeSegment:
    def __init__(self, start, end, text):
        self.start = start
        self.end = end
        self.text = text


class _FakeInfo:
    def __init__(self, language, duration=1.2):
        self.language = language
        self.duration = duration


class _FakeModel:
    def transcribe(self, local_audio_path, beam_size=5):
        self.local_audio_path = local_audio_path
        return iter([_FakeSegment(0.0, 1.2, "hello whisper")]), _FakeInfo("en")


class FasterWhisperTranscriberTests(unittest.TestCase):
    def test_maps_faster_whisper_output_to_transcript_result(self) -> None:
        transcriber = FasterWhisperTranscriber(
            model_name="small",
            device="cpu",
            compute_type="int8",
            model_factory=lambda *_args, **_kwargs: _FakeModel(),
        )

        result = transcriber.transcribe("/tmp/example.wav")

        self.assertEqual(result["language"], "en")
        self.assertEqual(
            result["segments"],
            [{"start_ms": 0, "end_ms": 1200, "text": "hello whisper"}],
        )

    def test_reports_real_progress_as_segments_are_materialized(self) -> None:
        progress_updates = []
        transcriber = FasterWhisperTranscriber(
            model_name="small",
            device="cpu",
            compute_type="int8",
            model_factory=lambda *_args, **_kwargs: _FakeModel(),
        )

        transcriber.transcribe(
            "/tmp/example.wav",
            on_progress=lambda update: progress_updates.append(update),
        )

        self.assertEqual(progress_updates[0]["processed_ms"], 1200)
        self.assertEqual(progress_updates[0]["total_ms"], 1200)
        self.assertEqual(progress_updates[-1]["percent"], 100)


if __name__ == "__main__":
    unittest.main()
