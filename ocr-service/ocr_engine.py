from __future__ import annotations

import time
from dataclasses import dataclass
from os import environ
from typing import Any

import numpy as np


MODEL_TIERS = {
    "tiny": {
        "det": "PP-OCRv6_tiny_det",
        "rec": "PP-OCRv6_tiny_rec",
    },
    "small": {
        "det": "PP-OCRv6_small_det",
        "rec": "PP-OCRv6_small_rec",
    },
    "medium": {
        "det": "PP-OCRv6_medium_det",
        "rec": "PP-OCRv6_medium_rec",
    },
}

SUPPORTED_LANGUAGES = {"auto", "ch", "en", "korean", "japan"}
AUTO_LANGUAGE_CANDIDATES = ("ch", "korean")
KOREAN_MODEL = {
    "det": "PP-OCRv5_server_det",
    "rec": "korean_PP-OCRv5_mobile_rec",
}


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    bounds: dict[str, int]


def _to_builtin(value: Any) -> Any:
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {key: _to_builtin(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_to_builtin(item) for item in value]
    return value


def _result_to_dict(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        payload = result
    elif hasattr(result, "json"):
        payload = result.json
    elif hasattr(result, "to_dict"):
        payload = result.to_dict()
    else:
        payload = {}

    payload = _to_builtin(payload)
    if isinstance(payload, dict) and "res" in payload and isinstance(payload["res"], dict):
        return payload["res"]
    return payload if isinstance(payload, dict) else {}


def _poly_to_bounds(poly: Any) -> dict[str, int]:
    points = _to_builtin(poly)
    xs: list[float] = []
    ys: list[float] = []

    if isinstance(points, list):
        for point in points:
            if isinstance(point, list | tuple) and len(point) >= 2:
                xs.append(float(point[0]))
                ys.append(float(point[1]))

    if not xs or not ys:
        return {"x": 0, "y": 0, "width": 0, "height": 0}

    left = int(min(xs))
    top = int(min(ys))
    right = int(max(xs))
    bottom = int(max(ys))
    return {
        "x": left,
        "y": top,
        "width": max(0, right - left),
        "height": max(0, bottom - top),
    }


def _merge_line_items(items: list[OcrLine]) -> list[OcrLine]:
    if len(items) <= 1:
        return items

    sorted_items = sorted(items, key=lambda item: (item.bounds["y"], item.bounds["x"]))
    groups: list[list[OcrLine]] = []

    for item in sorted_items:
        center_y = item.bounds["y"] + item.bounds["height"] / 2
        if not groups:
            groups.append([item])
            continue

        last_group = groups[-1]
        last_center_y = sum(
            line.bounds["y"] + line.bounds["height"] / 2 for line in last_group
        ) / len(last_group)
        tolerance = max(10, item.bounds["height"] * 0.65)

        if abs(center_y - last_center_y) <= tolerance:
            last_group.append(item)
        else:
            groups.append([item])

    merged: list[OcrLine] = []
    for group in groups:
        group = sorted(group, key=lambda item: item.bounds["x"])
        text = " ".join(item.text for item in group if item.text).strip()
        confidence = sum(item.confidence for item in group) / len(group)
        left = min(item.bounds["x"] for item in group)
        top = min(item.bounds["y"] for item in group)
        right = max(item.bounds["x"] + item.bounds["width"] for item in group)
        bottom = max(item.bounds["y"] + item.bounds["height"] for item in group)
        merged.append(
            OcrLine(
                text=text,
                confidence=confidence,
                bounds={
                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top,
                },
            )
        )

    return [line for line in merged if line.text]


def normalize_language(language: str | None) -> str:
    value = (language or "auto").strip().lower().replace("-", "_")
    aliases = {
        "ko": "korean",
        "kr": "korean",
        "kor": "korean",
        "ko_kr": "korean",
        "jp": "japan",
        "ja": "japan",
        "ja_jp": "japan",
        "zh": "ch",
        "zh_cn": "ch",
        "cn": "ch",
    }
    value = aliases.get(value, value)
    return value if value in SUPPORTED_LANGUAGES else "auto"


def _auto_language_candidates() -> list[str]:
    configured = environ.get("OVERWATCH_OCR_AUTO_LANGS", "")
    if configured:
        candidates = [
            normalize_language(candidate)
            for candidate in configured.replace(";", ",").split(",")
        ]
        candidates = [candidate for candidate in candidates if candidate != "auto"]
    else:
        candidates = list(AUTO_LANGUAGE_CANDIDATES)

    unique: list[str] = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)

    return unique or list(AUTO_LANGUAGE_CANDIDATES)


def _joined_text(lines: list[OcrLine]) -> str:
    return " ".join(line.text for line in lines)


def _count_hangul(text: str) -> int:
    return sum(1 for char in text if "\uac00" <= char <= "\ud7af")


def _result_score(lines: list[OcrLine], language: str) -> float:
    if not lines:
        return 0.0

    total_weight = 0
    weighted_confidence = 0.0
    for line in lines:
        weight = max(1, len(line.text.strip()))
        total_weight += weight
        weighted_confidence += line.confidence * weight

    score = weighted_confidence / max(1, total_weight)
    text = _joined_text(lines)
    hangul_count = _count_hangul(text)

    if language == "korean":
        if hangul_count:
            score += min(0.24, hangul_count / max(1, len(text)) * 0.8)
        else:
            score -= 0.18
    elif hangul_count:
        score -= 0.12

    return score


def _select_auto_result(
    candidates: list[tuple[str, list[OcrLine], float]],
) -> tuple[list[OcrLine], float]:
    primary_language, primary_lines, _ = candidates[0]
    primary_score = _result_score(primary_lines, primary_language)
    best_lines = primary_lines
    best_score = primary_score
    total_elapsed = sum(elapsed for _, _, elapsed in candidates)

    for language, lines, _elapsed in candidates[1:]:
        score = _result_score(lines, language)
        text = _joined_text(lines)

        if language == "korean" and _count_hangul(text) >= 2:
            if score >= primary_score - 0.05 or primary_score < 0.78:
                return lines, total_elapsed

        if score > best_score + 0.08:
            best_lines = lines
            best_score = score

    return best_lines, total_elapsed


class PaddleOcrEngine:
    def __init__(self) -> None:
        self._engines: dict[tuple[str, str, str, int], Any] = {}

    def is_loaded(self) -> bool:
        return bool(self._engines)

    def load(
        self,
        *,
        model_tier: str = "small",
        language: str = "auto",
        device: str = "cpu",
        cpu_threads: int = 6,
    ) -> Any:
        tier = model_tier if model_tier in MODEL_TIERS else "small"
        normalized_language = normalize_language(language)
        if normalized_language == "auto":
            normalized_language = "ch"
        config = (tier, normalized_language, device, cpu_threads)

        if config in self._engines:
            return self._engines[config]

        from paddleocr import PaddleOCR  # Imported lazily so /health works without deps.

        if normalized_language == "korean":
            models = KOREAN_MODEL
        else:
            models = MODEL_TIERS[tier]

        engine = PaddleOCR(
            text_detection_model_name=models["det"],
            text_recognition_model_name=models["rec"],
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device=device,
            engine="paddle_static",
            enable_mkldnn=False,
            cpu_threads=cpu_threads,
        )
        self._engines[config] = engine
        return engine

    def _recognize_with_language(
        self,
        image_rgb: np.ndarray,
        *,
        model_tier: str = "small",
        language: str = "ch",
        device: str = "cpu",
        cpu_threads: int = 6,
    ) -> tuple[list[OcrLine], float]:
        ocr = self.load(
            model_tier=model_tier,
            language=language,
            device=device,
            cpu_threads=cpu_threads,
        )

        started = time.perf_counter()
        results = ocr.predict(image_rgb)
        elapsed_ms = (time.perf_counter() - started) * 1000

        lines: list[OcrLine] = []
        for result in results:
            payload = _result_to_dict(result)
            texts = payload.get("rec_texts") or []
            scores = payload.get("rec_scores") or []
            polys = payload.get("rec_polys") or payload.get("dt_polys") or []

            for index, text in enumerate(texts):
                text_value = str(text).strip()
                if not text_value:
                    continue

                score = scores[index] if index < len(scores) else 1.0
                poly = polys[index] if index < len(polys) else None
                lines.append(
                    OcrLine(
                        text=text_value,
                        confidence=float(score),
                        bounds=_poly_to_bounds(poly),
                    )
                )

        return _merge_line_items(lines), elapsed_ms

    def recognize(
        self,
        image_rgb: np.ndarray,
        *,
        model_tier: str = "small",
        language: str = "auto",
        device: str = "cpu",
        cpu_threads: int = 6,
    ) -> tuple[list[OcrLine], float]:
        normalized_language = normalize_language(language)
        if normalized_language != "auto":
            return self._recognize_with_language(
                image_rgb,
                model_tier=model_tier,
                language=normalized_language,
                device=device,
                cpu_threads=cpu_threads,
            )

        candidates = [
            (
                candidate,
                *self._recognize_with_language(
                    image_rgb,
                    model_tier=model_tier,
                    language=candidate,
                    device=device,
                    cpu_threads=cpu_threads,
                ),
            )
            for candidate in _auto_language_candidates()
        ]
        return _select_auto_result(candidates)
