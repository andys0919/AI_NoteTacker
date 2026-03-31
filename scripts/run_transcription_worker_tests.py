from pathlib import Path
import os
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = ROOT / "workers" / "transcription-worker" / "src"
PACKAGE_SRC_PATH = ROOT / "packages" / "meeting-ai-pipeline" / "src"

environment = os.environ.copy()
existing_pythonpath = environment.get("PYTHONPATH", "")
environment["PYTHONPATH"] = os.pathsep.join(
    [str(PACKAGE_SRC_PATH), str(SRC_PATH), existing_pythonpath]
).rstrip(os.pathsep)

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
