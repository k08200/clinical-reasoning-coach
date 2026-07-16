#!/usr/bin/env python3
"""Run the configured model through the release safety evaluation suite."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.model_release_evaluation import run_model_release_evaluation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path for the clinician-reviewable JSON evaluation artifact.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = asyncio.run(run_model_release_evaluation())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "sha256": report["sha256"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
