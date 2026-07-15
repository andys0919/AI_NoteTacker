import unittest

from transcription_worker.config import (
    DEFAULT_AZURE_TRANSCRIBE_PROMPT,
    read_transcription_worker_config,
)


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
                "control_plane_timeout_seconds": 30,
                "internal_service_token": None,
                "worker_id": "transcriber-alpha",
                "deployment_mode": "default",
                "whisper_model": "small",
                "whisper_device": "cpu",
                "whisper_compute_type": "int8",
                "summary_enabled": False,
                "summary_model": "gpt-5.4-mini",
                "summary_reasoning_effort": "medium",
                "codex_cli_path": "codex",
                "azure_openai_summary_endpoint": None,
                "azure_openai_summary_api_key": None,
                "azure_openai_summary_timeout_seconds": 300,
                "poll_interval_ms": 1000,
                "azure_openai_endpoint": None,
                "azure_openai_deployment": None,
                "azure_openai_api_key": None,
                "azure_openai_api_version": "2025-03-01-preview",
                "azure_openai_transcribe_timeout_seconds": 300,
                "azure_openai_transcribe_language": "",
                "azure_openai_transcribe_prompt": DEFAULT_AZURE_TRANSCRIBE_PROMPT,
                "transcript_punctuation_enabled": True,
                "transcript_punctuation_model": "gpt-5.4-mini",
                "azure_openai_punctuation_timeout_seconds": 30,
            },
        )

    def test_reads_optional_azure_openai_transcription_config(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_ENDPOINT": "https://azure.example.test",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-transcribe",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_API_VERSION": "2025-04-01-preview",
            }
        )

        self.assertEqual(config["azure_openai_endpoint"], "https://azure.example.test")
        self.assertEqual(config["azure_openai_deployment"], "gpt-4o-transcribe")
        self.assertEqual(config["azure_openai_api_key"], "secret")
        self.assertEqual(config["azure_openai_api_version"], "2025-04-01-preview")

    def test_defaults_transcribe_prompt_to_multilingual_preservation_policy(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
            }
        )

        self.assertEqual(config["azure_openai_transcribe_language"], "")
        self.assertEqual(
            config["azure_openai_transcribe_prompt"], DEFAULT_AZURE_TRANSCRIBE_PROMPT
        )
        prompt = str(config["azure_openai_transcribe_prompt"])
        self.assertIn("保留原本語言", prompt)
        self.assertIn("不要翻譯", prompt)
        self.assertIn("正體中文", prompt)

    def test_enables_transcript_punctuation_by_default_with_summary_model(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
            }
        )

        self.assertIs(config["transcript_punctuation_enabled"], True)
        self.assertEqual(config["transcript_punctuation_model"], "gpt-5.4-mini")

    def test_defaults_responses_timeouts_per_caller(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
            }
        )

        self.assertEqual(config.get("azure_openai_summary_timeout_seconds"), 300)
        self.assertEqual(config.get("azure_openai_punctuation_timeout_seconds"), 30)

    def test_overrides_responses_timeouts_per_caller(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS": "240",
                "AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS": "20",
            }
        )

        self.assertEqual(config["azure_openai_summary_timeout_seconds"], 240)
        self.assertEqual(config["azure_openai_punctuation_timeout_seconds"], 20)

    def test_overrides_transcription_and_control_plane_timeouts(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "CONTROL_PLANE_TIMEOUT_SECONDS": "11",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS": "180",
            }
        )

        self.assertEqual(config["control_plane_timeout_seconds"], 11)
        self.assertEqual(config["azure_openai_transcribe_timeout_seconds"], 180)

    def test_rejects_invalid_transcription_and_control_plane_timeouts(self) -> None:
        invalid_values = {
            "CONTROL_PLANE_TIMEOUT_SECONDS": "0",
            "AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS": "slow",
        }

        for name, value in invalid_values.items():
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "positive integer"):
                    read_transcription_worker_config(
                        {
                            "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                            "WORKER_ID": "transcriber-alpha",
                            "WHISPER_MODEL": "large-v3",
                            name: value,
                        }
                    )

    def test_rejects_non_positive_responses_timeout(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive integer"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS": "0",
                }
            )

    def test_rejects_non_numeric_responses_timeout(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive integer"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS": "slow",
                }
            )

    def test_allows_disabling_and_overriding_punctuation_model(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "TRANSCRIPT_PUNCTUATION_ENABLED": "false",
                "AZURE_OPENAI_PUNCTUATION_MODEL": "gpt-4o-mini",
            }
        )

        self.assertIs(config["transcript_punctuation_enabled"], False)
        self.assertEqual(config["transcript_punctuation_model"], "gpt-4o-mini")

    def test_allows_overriding_transcribe_language_and_prompt(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_TRANSCRIBE_LANGUAGE": "zh",
                "AZURE_OPENAI_TRANSCRIBE_PROMPT": "請輸出繁體中文。",
            }
        )

        self.assertEqual(config["azure_openai_transcribe_language"], "zh")
        self.assertEqual(config["azure_openai_transcribe_prompt"], "請輸出繁體中文。")

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
        self.assertEqual(config["summary_model"], "gpt-5.4-mini")

    def test_does_not_reuse_azure_transcription_credentials_for_summary(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "DEPLOYMENT_MODE": "cloud",
                "AZURE_OPENAI_ENDPOINT": "https://azure.example.test",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-transcribe",
                "AZURE_OPENAI_API_KEY": "secret",
            }
        )

        self.assertIsNone(config["azure_openai_summary_endpoint"])
        self.assertIsNone(config["azure_openai_summary_api_key"])

    def test_rejects_non_responses_summary_endpoint(self) -> None:
        with self.assertRaisesRegex(ValueError, "/openai/v1/responses"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_SUMMARY_ENDPOINT": (
                        "https://azure.example.test/openai/v1/chat/completions"
                    ),
                    "AZURE_OPENAI_SUMMARY_API_KEY": "secret",
                }
            )

    def test_rejects_non_https_summary_endpoint(self) -> None:
        with self.assertRaisesRegex(ValueError, "https"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_SUMMARY_ENDPOINT": (
                        "http://azure.example.test/openai/v1/responses"
                    ),
                    "AZURE_OPENAI_SUMMARY_API_KEY": "secret",
                }
            )

    def test_rejects_responses_endpoint_without_a_hostname(self) -> None:
        with self.assertRaisesRegex(ValueError, "/openai/v1/responses"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_SUMMARY_ENDPOINT": "https:///openai/v1/responses",
                    "AZURE_OPENAI_SUMMARY_API_KEY": "secret",
                }
            )


if __name__ == "__main__":
    unittest.main()
