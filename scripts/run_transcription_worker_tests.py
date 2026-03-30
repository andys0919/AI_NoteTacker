from pathlib import Path
import os
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = ROOT / "workers" / "transcription-worker" / "src"

environment = os.environ.copy()
environment["PYTHONPATH"] = str(SRC_PATH)

result = subprocess.run(
    [
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        str(ROOT / "workers" / "transcription-worker" / "tests"),
        "-p",
        "test_*.py",
    ],
    cwd=ROOT,
    env=environment,
)

sys.exit(result.returncode)
