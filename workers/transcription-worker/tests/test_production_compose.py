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
        environment["CODEX_HOME"] = environment.get("CODEX_HOME") or "/tmp/codex-home"
        environment["INTERNAL_SERVICE_TOKEN"] = "x" * 32
        environment["MINIO_ROOT_PASSWORD"] = "test-only"
        environment["MINIO_ROOT_USER"] = "test-only"
        environment["POSTGRES_PASSWORD"] = "test-only"
        environment["SUMMARY_MODEL"] = "compose-model-sentinel"

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
        services = json.loads(result.stdout)["services"]

        self.assertEqual(services["transcription-worker"]["build"]["target"], "transcription")
        self.assertNotIn("SUMMARY_MODEL", services["transcription-worker"]["environment"])
        self.assertEqual(
            services["summary-worker"]["environment"]["SUMMARY_MODEL"],
            "compose-model-sentinel",
        )
        self.assertEqual(services["summary-worker"]["build"]["target"], "summary")


if __name__ == "__main__":
    unittest.main()
