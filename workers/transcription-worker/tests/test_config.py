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
                "deployment_mode": "default",
                "whisper_model": "small",
                "whisper_device": "cpu",
                "whisper_compute_type": "int8",
                "summary_enabled": False,
                "summary_model": "gpt-5.3-codex-spark",
                "summary_reasoning_effort": "medium",
                "codex_cli_path": "codex",
                "azure_openai_summary_endpoint": None,
                "azure_openai_summary_api_key": None,
                "poll_interval_ms": 1000,
                "azure_openai_endpoint": None,
                "azure_openai_deployment": None,
                "azure_openai_api_key": None,
                "azure_openai_api_version": "2025-03-01-preview",
            },
        )

    def test_reads_optional_azure_openai_transcription_config(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_ENDPOINT": "https://azure.example.test",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-mini-transcribe",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_API_VERSION": "2025-04-01-preview",
            }
        )

        self.assertEqual(config["azure_openai_endpoint"], "https://azure.example.test")
        self.assertEqual(config["azure_openai_deployment"], "gpt-4o-mini-transcribe")
        self.assertEqual(config["azure_openai_api_key"], "secret")
        self.assertEqual(config["azure_openai_api_version"], "2025-04-01-preview")

    def test_uses_local_deployment_defaults_for_gpu_whisper(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "DEPLOYMENT_MODE": "local",
            }
        )

        self.assertEqual(config["deployment_mode"], "local")
        self.assertEqual(config["whisper_device"], "cuda")
        self.assertEqual(config["summary_model"], "gpt-5.3-codex-spark")

    def test_uses_cloud_deployment_defaults_for_azure_transcription_and_gpt_5_mini_summary(
        self,
    ) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "DEPLOYMENT_MODE": "cloud",
                "AZURE_OPENAI_ENDPOINT": "https://azure.example.test",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-mini-transcribe",
                "AZURE_OPENAI_API_KEY": "secret",
            }
        )

        self.assertEqual(config["deployment_mode"], "cloud")
        self.assertEqual(
            config["azure_openai_summary_endpoint"],
            "https://azure.example.test/openai/v1/chat/completions",
        )
        self.assertEqual(config["summary_model"], "gpt-5-mini")


if __name__ == "__main__":
    unittest.main()
