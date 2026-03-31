from pathlib import Path
import os
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = ROOT / "workers" / "transcription-worker" / "src"
DEFAULT_PACKAGE_SRC_PATH = Path("/home/solomon/Andy/meeting-ai-pipeline/src")
PACKAGE_SRC_PATH = Path(
    os.environ.get("MEETING_AI_PIPELINE_SRC", str(DEFAULT_PACKAGE_SRC_PATH))
)

if not PACKAGE_SRC_PATH.exists():
    raise SystemExit(
        f"meeting-ai-pipeline source path not found: {PACKAGE_SRC_PATH}. "
        "Set MEETING_AI_PIPELINE_SRC to the external package checkout."
    )

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
