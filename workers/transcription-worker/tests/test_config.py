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
                "azure_openai_summary_endpoint": None,
                "azure_openai_summary_api_key": None,
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
                "azure_openai_diarize_endpoint": None,
                "azure_openai_diarize_model": None,
                "azure_openai_diarize_api_key": None,
                "azure_openai_diarize_api_version": "2025-04-01-preview",
                "azure_openai_diarize_timeout_seconds": 300,
                "azure_openai_diarize_max_workers": 3,
                "transcript_punctuation_enabled": True,
                "transcript_punctuation_model": "gpt-5.6-luna",
                "transcript_polishing_reasoning_effort": "max",
                "azure_openai_punctuation_timeout_seconds": 300,
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

    def test_reads_complete_optional_diarization_config(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_DIARIZE_ENDPOINT": "https://diarize.example.test",
                "AZURE_OPENAI_DIARIZE_MODEL": "gpt-4o-transcribe-diarize",
                "AZURE_OPENAI_DIARIZE_API_KEY": "diarize-secret",
                "AZURE_OPENAI_DIARIZE_API_VERSION": "2025-05-01-preview",
                "AZURE_OPENAI_DIARIZE_TIMEOUT_SECONDS": "240",
                "AZURE_OPENAI_DIARIZE_MAX_WORKERS": "2",
            }
        )

        self.assertEqual(
            config["azure_openai_diarize_endpoint"],
            "https://diarize.example.test",
        )
        self.assertEqual(
            config["azure_openai_diarize_model"],
            "gpt-4o-transcribe-diarize",
        )
        self.assertEqual(config["azure_openai_diarize_api_key"], "diarize-secret")
        self.assertEqual(
            config["azure_openai_diarize_api_version"],
            "2025-05-01-preview",
        )
        self.assertEqual(config["azure_openai_diarize_timeout_seconds"], 240)
        self.assertEqual(config["azure_openai_diarize_max_workers"], 2)

    def test_rejects_partial_diarization_config(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be configured together"):
            read_transcription_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "transcriber-alpha",
                    "WHISPER_MODEL": "large-v3",
                    "AZURE_OPENAI_DIARIZE_ENDPOINT": "https://diarize.example.test",
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

    def test_enables_transcript_punctuation_by_default_with_summary_model(self) -> None:
        config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
            }
        )

        self.assertIs(config["transcript_punctuation_enabled"], True)
        self.assertEqual(config["transcript_punctuation_model"], "gpt-5.6-luna")
        self.assertEqual(config["transcript_polishing_reasoning_effort"], "max")

    def test_defaults_responses_timeouts_per_caller(self) -> None:
        transcription_config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
            }
        )
        summary_config = read_summary_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "summarizer-alpha",
            }
        )

        self.assertEqual(summary_config["azure_openai_summary_timeout_seconds"], 300)
        self.assertEqual(transcription_config["azure_openai_punctuation_timeout_seconds"], 300)

    def test_overrides_responses_timeouts_per_caller(self) -> None:
        transcription_config = read_transcription_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "transcriber-alpha",
                "WHISPER_MODEL": "large-v3",
                "AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS": "20",
            }
        )
        summary_config = read_summary_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                "WORKER_ID": "summarizer-alpha",
                "AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS": "240",
            }
        )

        self.assertEqual(summary_config["azure_openai_summary_timeout_seconds"], 240)
        self.assertEqual(transcription_config["azure_openai_punctuation_timeout_seconds"], 20)

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
            read_summary_worker_config(
                {
                    "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
                    "WORKER_ID": "summarizer-alpha",
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

        self.assertEqual(config["whisper_device"], "cuda")

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


class ReadSummaryWorkerConfigTests(unittest.TestCase):
    def test_reads_summary_config_without_whisper(self) -> None:
        config = read_summary_worker_config(
            {
                "CONTROL_PLANE_BASE_URL": "http://127.0.0.1:3000",
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
                "codex_cli_path": "codex",
                "azure_openai_summary_endpoint": None,
                "azure_openai_summary_api_key": None,
                "azure_openai_summary_timeout_seconds": 300,
            },
        )


if __name__ == "__main__":
    unittest.main()
