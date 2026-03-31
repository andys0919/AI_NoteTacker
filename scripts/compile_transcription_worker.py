from pathlib import Path
import compileall
import os
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORY = ROOT / "workers" / "transcription-worker" / "src"
DEFAULT_PACKAGE_SOURCE_DIRECTORY = Path("/home/solomon/Andy/meeting-ai-pipeline/src")
PACKAGE_SOURCE_DIRECTORY = Path(
    os.environ.get("MEETING_AI_PIPELINE_SRC", str(DEFAULT_PACKAGE_SOURCE_DIRECTORY))
)

if not PACKAGE_SOURCE_DIRECTORY.exists():
    raise SystemExit(
        f"meeting-ai-pipeline source path not found: {PACKAGE_SOURCE_DIRECTORY}. "
        "Set MEETING_AI_PIPELINE_SRC to the external package checkout."
    )

success = compileall.compile_dir(str(PACKAGE_SOURCE_DIRECTORY), quiet=1)
success = compileall.compile_dir(str(SOURCE_DIRECTORY), quiet=1) and success
sys.exit(0 if success else 1)
