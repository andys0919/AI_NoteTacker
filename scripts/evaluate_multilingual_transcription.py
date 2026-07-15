import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers" / "transcription-worker" / "src"))

from transcription_worker.benchmark_metrics import evaluate_benchmark  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score one transcription run against a versioned corpus manifest."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("results", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()

    report = evaluate_benchmark(
        json.loads(arguments.manifest.read_text(encoding="utf-8")),
        json.loads(arguments.results.read_text(encoding="utf-8")),
    )
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if arguments.output:
        arguments.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
