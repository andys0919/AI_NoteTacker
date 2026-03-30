from pathlib import Path
import compileall
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORY = ROOT / "workers" / "transcription-worker" / "src"

success = compileall.compile_dir(str(SOURCE_DIRECTORY), quiet=1)
sys.exit(0 if success else 1)
