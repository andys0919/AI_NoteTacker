import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]


class ProductionComposeTests(unittest.TestCase):
    def test_screenapp_override_preserves_worker_targets_and_stage_settings(self) -> None:
        environment = os.environ.copy()
        environment["ADMIN_CONSOLE_PASSWORD"] = "test-only"
        environment["INTERNAL_SERVICE_TOKEN"] = "x" * 32
        environment["MINIO_ROOT_PASSWORD"] = "test-only"
        environment["MINIO_ROOT_USER"] = "test-only"
        environment["POSTGRES_PASSWORD"] = "test-only"
        environment["SUMMARY_MODEL"] = "compose-model-sentinel"
        environment["AZURE_OPENAI_SUMMARY_ENDPOINT"] = (
            "https://azure.example.test/openai/v1/responses"
        )
        environment["AZURE_OPENAI_SUMMARY_API_KEY"] = "summary-key-sentinel"

        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "-f",
                "docker-compose.screenapp.yml",
                "config",
                "--format",
                "json",
            ],
            cwd=ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        configuration = json.loads(result.stdout)
        services = configuration["services"]

        self.assertEqual(services["transcription-worker"]["build"]["target"], "transcription")
        self.assertNotIn("SUMMARY_MODEL", services["transcription-worker"]["environment"])
        self.assertEqual(
            services["summary-worker"]["environment"]["SUMMARY_MODEL"],
            "compose-model-sentinel",
        )
        self.assertEqual(services["summary-worker"]["build"]["target"], "summary")
        self.assertEqual(
            services["summary-worker"]["volumes"],
            [
                {
                    "type": "volume",
                    "source": "summary_codex_home",
                    "target": "/codex-home",
                    "volume": {},
                }
            ],
        )
        self.assertEqual(
            configuration["volumes"]["summary_codex_home"]["name"],
            "ai_notetacker_summary_codex_home",
        )
        self.assertTrue(configuration["volumes"]["summary_codex_home"]["external"])
        self.assertEqual(
            services["summary-worker"]["environment"]["AZURE_OPENAI_SUMMARY_ENDPOINT"],
            "",
        )
        self.assertEqual(
            services["summary-worker"]["environment"]["AZURE_OPENAI_SUMMARY_API_KEY"],
            "",
        )
        for service_name in ("control-plane", "transcription-worker"):
            self.assertNotIn(
                "AZURE_OPENAI_SUMMARY_ENDPOINT",
                services[service_name]["environment"],
            )
            self.assertNotIn(
                "AZURE_OPENAI_SUMMARY_API_KEY",
                services[service_name]["environment"],
            )


if __name__ == "__main__":
    unittest.main()
