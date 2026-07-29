from pathlib import Path
import compileall
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORY = ROOT / "workers" / "transcription-worker" / "src"

if not SOURCE_DIRECTORY.exists():
    # compileall.compile_dir returns a truthy value for a missing directory, so without
    # this guard a missing worker source tree would be reported as a successful build.
    raise SystemExit(f"transcription worker source path not found: {SOURCE_DIRECTORY}")

success = compileall.compile_dir(str(SOURCE_DIRECTORY), quiet=1)
sys.exit(0 if success else 1)
