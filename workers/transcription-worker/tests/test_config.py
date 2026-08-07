import unittest

from transcription_worker.config import (
    DEFAULT_AZURE_TRANSCRIBE_PROMPT,
    read_summary_worker_config,
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
                "poll_interval_ms": 1000,
                "whisper_model": "small",
                "whisper_device": "cpu",
                "whisper_compute_type": "int8",
                "azure_openai_endpoint": None,
                "azure_openai_deployment": None,
                "azure_openai_api_key": None,
                "azure_openai_api_version": "2025-03-01-preview",
                "azure_openai_transcribe_timeout_seconds": 300,
                "azure_openai_transcribe_language": "",
                "azure_openai_transcribe_prompt": DEFAULT_AZURE_TRANSCRIBE_PROMPT,
                "qwen_asr_endpoint": None,
                "qwen_asr_model": None,
                "qwen_asr_timeout_seconds": 300,
                "azure_speech_mai_endpoint": None,
                "azure_speech_mai_model": None,
                "azure_speech_mai_api_key": None,
                "azure_speech_mai_api_version": "2025-10-15",
                "azure_speech_mai_timeout_seconds": 300,
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

    def test_reads_qwen_transcription_config(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "QWEN_ASR_ENDPOINT": "http://qwen3-asr:8000",
                "QWEN_ASR_MODEL": "qwen3-asr-1.7b",
                "QWEN_ASR_TIMEOUT_SECONDS": "180",
            }
        )

        self.assertEqual(config["qwen_asr_endpoint"], "http://qwen3-asr:8000")
        self.assertEqual(config["qwen_asr_model"], "qwen3-asr-1.7b")
        self.assertEqual(config["qwen_asr_timeout_seconds"], 180)

    def test_reads_complete_mai_transcription_config(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_SPEECH_MAI_ENDPOINT": "https://speech.example.test",
                "AZURE_SPEECH_MAI_MODEL": "mai-transcribe-1.5",
                "AZURE_SPEECH_MAI_API_KEY": "secret",
            }
        )

        self.assertEqual(
            config["azure_speech_mai_endpoint"], "https://speech.example.test"
        )
        self.assertEqual(config["azure_speech_mai_model"], "mai-transcribe-1.5")
        self.assertEqual(config["azure_speech_mai_api_key"], "secret")

    def test_rejects_partial_mai_transcription_config(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be configured together"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_SPEECH_MAI_ENDPOINT": "https://speech.example.test",
                }
            )

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

        self.assertEqual(config["whisper_device"], "cuda")

    def test_ignores_obsolete_polishing_and_diarization_settings(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "DEPLOYMENT_MODE": "cloud",
                "AZURE_OPENAI_ENDPOINT": "https://azure.example.test",
                "AZURE_OPENAI_DEPLOYMENT": "gpt-4o-transcribe",
                "AZURE_OPENAI_API_KEY": "secret",
                "TRANSCRIPT_PUNCTUATION_ENABLED": "true",
                "AZURE_OPENAI_DIARIZE_ENDPOINT": "https://diarize.example.test",
            }
        )

        self.assertNotIn("transcript_punctuation_enabled", config)
        self.assertNotIn("azure_openai_diarize_endpoint", config)


class ReadSummaryWorkerConfigTests(unittest.TestCase):
    def test_reads_summary_config_without_whisper(self) -> None:
        config = read_summary_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "CODEX_PTY_API_TOKEN": "test-only-token",
                "CODEX_PTY_API_URL": "http://codex-pty-agent:3001/api/prompt",
                "WORKER_ID": "summarizer-alpha",
            }
        )

        self.assertEqual(
            config,
            {
                "control_plane_base_url": "http://127.0.0.1:3000",
                "control_plane_timeout_seconds": 30,
                "internal_service_token": None,
                "worker_id": "summarizer-alpha",
                "poll_interval_ms": 1000,
                "summary_model": "gpt-5.6-luna",
                "summary_reasoning_effort": "max",
                "summary_timeout_seconds": 900,
                "codex_pty_api_url": "http://codex-pty-agent:3001/api/prompt",
                "codex_pty_api_token": "test-only-token",
                "codex_cli_path": "codex",
                "azure_openai_summary_endpoint": None,
                "azure_openai_summary_api_key": None,
                "azure_openai_summary_timeout_seconds": 900,
            },
        )

    def test_uses_only_a_complete_https_azure_fallback_pair(self) -> None:
        base = {
            "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
            "CODEX_PTY_API_TOKEN": "test-only-token",
            "CODEX_PTY_API_URL": "http://codex-pty-agent:3001/api/prompt",
            "WORKER_ID": "summarizer-alpha",
        }
        incomplete = read_summary_worker_config(
            {**base, "AZURE_OPENAI_SUMMARY_API_KEY": "secret"}
        )
        self.assertIsNone(incomplete["azure_openai_summary_endpoint"])
        self.assertIsNone(incomplete["azure_openai_summary_api_key"])
        with self.assertRaisesRegex(ValueError, "https URL"):
            read_summary_worker_config(
                {
                    **base,
                    "AZURE_OPENAI_SUMMARY_ENDPOINT": "http://example.test/openai/v1/responses",
                    "AZURE_OPENAI_SUMMARY_API_KEY": "secret",
                }
            )

        config = read_summary_worker_config(
            {
                **base,
                "AZURE_OPENAI_SUMMARY_ENDPOINT": "https://example.test/openai/v1/responses",
                "AZURE_OPENAI_SUMMARY_API_KEY": "secret",
                "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS": "45",
            }
        )
        self.assertEqual(config["azure_openai_summary_timeout_seconds"], 45)


if __name__ == "__main__":
    unittest.main()
