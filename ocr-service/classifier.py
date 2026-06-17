from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


MessageKind = Literal["player", "system", "unknown"]

MIN_CONFIDENCE = 0.35

_CHAR_TRANSLATION = str.maketrans(
    {
        "【": "[",
        "［": "[",
        "〔": "[",
        "「": "[",
        "『": "[",
        "{": "[",
        "(": "[",
        "（": "[",
        "】": "]",
        "］": "]",
        "〕": "]",
        "」": "]",
        "』": "]",
        "}": "]",
        ")": "]",
        "）": "]",
        "：": ":",
        "﹕": ":",
        "：": ":",
    }
)

PLAYER_MESSAGE_RE = re.compile(
    r"^\s*\[(?P<speaker>[^\[\]:]{1,32})\]\s*:\s*(?P<text>.+?)\s*$"
)

SYSTEM_HINT_RE = re.compile(
    r"\b("
    r"joined|left|entered|exited|switched|spectating|"
    r"team chat|match chat|group chat|voice chat|"
    r"you are now|welcome|press enter|endorsement|"
    r"已加入|已离开|进入了|切换到|小队语音|团队聊天|比赛聊天"
    r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Bounds:
    x: int
    y: int
    width: int
    height: int

    def to_dict(self) -> dict[str, int]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }


@dataclass(frozen=True)
class ClassifiedMessage:
    kind: MessageKind
    speaker: str | None
    text: str
    confidence: float
    rawLine: str
    bounds: dict[str, int] | None

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "speaker": self.speaker,
            "text": self.text,
            "confidence": self.confidence,
            "rawLine": self.rawLine,
            "bounds": self.bounds,
        }


def normalize_line_for_classification(raw_line: str) -> str:
    line = raw_line.translate(_CHAR_TRANSLATION)
    line = re.sub(r"\s+", " ", line)
    line = line.replace("[ ", "[").replace(" ]", "]")
    line = line.replace(" :", ":").strip()
    return line


def classify_line(
    raw_line: str,
    confidence: float = 1.0,
    bounds: Bounds | dict[str, int] | None = None,
) -> ClassifiedMessage:
    raw = raw_line.strip()
    normalized = normalize_line_for_classification(raw_line)
    bounds_dict = bounds.to_dict() if isinstance(bounds, Bounds) else bounds

    if not raw:
        return ClassifiedMessage("unknown", None, "", confidence, raw_line, bounds_dict)

    if confidence < MIN_CONFIDENCE:
        return ClassifiedMessage("unknown", None, normalized, confidence, raw_line, bounds_dict)

    match = PLAYER_MESSAGE_RE.match(normalized)
    if match:
        speaker = match.group("speaker").strip()
        text = match.group("text").strip()

        if speaker and text:
            return ClassifiedMessage("player", speaker, text, confidence, raw_line, bounds_dict)

    if SYSTEM_HINT_RE.search(normalized):
        return ClassifiedMessage("system", None, normalized, confidence, raw_line, bounds_dict)

    return ClassifiedMessage("system", None, normalized, confidence, raw_line, bounds_dict)


def stable_message_key(message: ClassifiedMessage) -> str:
    speaker = message.speaker or ""
    text = re.sub(r"\s+", " ", message.text).strip().lower()
    return f"{message.kind}|{speaker.lower()}|{text}"
