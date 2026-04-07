import unittest

from transcription_worker.media_preparer import FFmpegMediaPreparer


class _FakeRunner:
    def __init__(self):
        self.commands = []

    def __call__(self, command, check):
        self.commands.append((command, check))


class FFmpegMediaPreparerTests(unittest.TestCase):
    def test_returns_existing_wav_without_reencoding(self) -> None:
        runner = _FakeRunner()
        preparer = FFmpegMediaPreparer(command_runner=runner)

        result = preparer.prepare("/tmp/example.wav", "audio/wav")

        self.assertEqual(result["local_audio_path"], "/tmp/example.wav")
        self.assertEqual(result["prepared"], False)
        self.assertEqual(runner.commands, [])

    def test_extracts_wav_from_video_or_compressed_audio(self) -> None:
        runner = _FakeRunner()
        preparer = FFmpegMediaPreparer(command_runner=runner)

        result = preparer.prepare("/tmp/example.mp4", "video/mp4")

        self.assertTrue(result["prepared"])
        self.assertTrue(result["local_audio_path"].endswith(".wav"))
        self.assertEqual(len(runner.commands), 1)
        self.assertIn("ffmpeg", runner.commands[0][0][0])
        self.assertEqual(runner.commands[0][0][3], "/tmp/example.mp4")


if __name__ == "__main__":
    unittest.main()
