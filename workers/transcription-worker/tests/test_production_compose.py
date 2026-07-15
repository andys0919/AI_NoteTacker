import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]


class ProductionComposeTests(unittest.TestCase):
    def test_screenapp_override_preserves_configured_summary_model(self) -> None:
        environment = os.environ.copy()
        environment["CODEX_HOME"] = environment.get("CODEX_HOME") or "/tmp/codex-home"
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

        self.assertEqual(
            services["transcription-worker"]["environment"]["SUMMARY_MODEL"],
            "compose-model-sentinel",
        )
        self.assertEqual(
            services["summary-worker"]["environment"]["SUMMARY_MODEL"],
            "compose-model-sentinel",
        )


if __name__ == "__main__":
    unittest.main()
