from __future__ import annotations

import argparse
import sys

import numpy as np

from ocr_engine import MODEL_TIERS, PaddleOcrEngine


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and initialize PaddleOCR models for packaged builds."
    )
    parser.add_argument(
        "--tiers",
        nargs="+",
        default=["tiny", "small"],
        help="Model tiers to warm up. Defaults to tiny small.",
    )
    parser.add_argument(
        "--languages",
        nargs="+",
        default=["auto"],
        help="OCR languages to warm up. Use auto to include default auto candidates.",
    )
    parser.add_argument("--device", default="cpu", help="Paddle device string.")
    parser.add_argument("--cpu-threads", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    invalid_tiers = [tier for tier in args.tiers if tier not in MODEL_TIERS]
    if invalid_tiers:
        print(
            f"Unknown model tier(s): {', '.join(invalid_tiers)}. "
            f"Available: {', '.join(MODEL_TIERS)}",
            file=sys.stderr,
        )
        return 2

    languages: list[str] = []
    for language in args.languages:
        if language == "auto":
            for candidate in ["ch", "korean"]:
                if candidate not in languages:
                    languages.append(candidate)
        elif language not in languages:
            languages.append(language)

    image = np.full((72, 320, 3), 255, dtype=np.uint8)
    engine = PaddleOcrEngine()
    for tier in args.tiers:
        for language in languages:
            print(f"Initializing PaddleOCR model tier: {tier}, language: {language}")
            engine.recognize(
                image,
                model_tier=tier,
                language=language,
                device=args.device,
                cpu_threads=args.cpu_threads,
            )

    print("PaddleOCR model warmup completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
