import unittest

from transcription_worker.config import read_transcription_worker_config


class ReadTranscriptionWorkerConfigTests(unittest.TestCase):
    def test_reads_transcription_worker_config_from_environment(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "small",
            }
        )

        self.assertEqual(
            config,
            {
                "control_plane_base_url": "http://127.0.0.1:3000",
                "worker_id": "transcriber-alpha",
                "whisper_model": "small",
                "whisper_device": "cpu",
                "whisper_compute_type": "int8",
                "summary_enabled": False,
                "summary_model": "gpt-5.3-codex-spark",
                "summary_reasoning_effort": "medium",
                "codex_cli_path": "codex",
                "poll_interval_ms": 1000,
            },
        )


if __name__ == "__main__":
    unittest.main()
