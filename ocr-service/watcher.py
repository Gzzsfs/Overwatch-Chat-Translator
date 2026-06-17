from __future__ import annotations

import asyncio
import hashlib
import time
from collections import deque
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image

from classifier import classify_line, stable_message_key
from ocr_engine import OcrLine, PaddleOcrEngine
from translator import create_translator


@dataclass(frozen=True)
class Roi:
    left: int
    top: int
    width: int
    height: int

    def as_mss_rect(self) -> dict[str, int]:
        return {
            "left": self.left,
            "top": self.top,
            "width": self.width,
            "height": self.height,
        }


def image_change_hash(image: Image.Image) -> str:
    sampled = image.convert("L").resize((96, 32))
    return hashlib.sha1(sampled.tobytes()).hexdigest()


class EventHub:
    def __init__(self) -> None:
        self._clients: set[Any] = set()

    async def connect(self, websocket: Any) -> None:
        await websocket.accept()
        self._clients.add(websocket)

    def disconnect(self, websocket: Any) -> None:
        self._clients.discard(websocket)

    async def broadcast(self, event: dict[str, Any]) -> None:
        disconnected: list[Any] = []
        for client in self._clients:
            try:
                await client.send_json(event)
            except Exception:  # noqa: BLE001 - stale websocket.
                disconnected.append(client)

        for client in disconnected:
            self.disconnect(client)


class WatchManager:
    def __init__(self, hub: EventHub) -> None:
        self.hub = hub
        self.ocr = PaddleOcrEngine()
        self.translator = create_translator()
        self.task: asyncio.Task[None] | None = None
        self.running = False
        self.last_error: str | None = None
        self.seen_keys: deque[str] = deque(maxlen=300)
        self.context: deque[dict[str, str]] = deque(maxlen=10)

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "ocrLoaded": self.ocr.is_loaded(),
            "translatorConfigured": self.translator.configured,
            "proxyConfigured": self.translator.configured,
            "lastError": self.last_error,
        }

    async def start(self, config: dict[str, Any]) -> dict[str, Any]:
        await self.stop()

        roi_payload = config.get("roi") or {}
        roi = Roi(
            left=int(roi_payload.get("left", 40)),
            top=int(roi_payload.get("top", 720)),
            width=max(20, int(roi_payload.get("width", 680))),
            height=max(20, int(roi_payload.get("height", 220))),
        )

        fps = max(0.2, min(5.0, float(config.get("fps", 1))))
        model_tier = str(config.get("modelTier", "small"))
        language = str(config.get("language", "auto"))
        device = str(config.get("device", "cpu"))
        cpu_threads = max(1, min(16, int(config.get("cpuThreads", 6))))
        translate = bool(config.get("translate", True))

        self.running = True
        self.last_error = None
        self.task = asyncio.create_task(
            self._run_loop(
                roi=roi,
                fps=fps,
                model_tier=model_tier,
                language=language,
                device=device,
                cpu_threads=cpu_threads,
                translate=translate,
            )
        )

        await self.hub.broadcast({"type": "ocr.status", "payload": self.status()})
        return self.status()

    async def stop(self) -> dict[str, Any]:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

        self.running = False
        await self.hub.broadcast({"type": "ocr.status", "payload": self.status()})
        return self.status()

    async def _capture(self, roi: Roi) -> Image.Image:
        def capture_once() -> Image.Image:
            import mss

            with mss.mss() as sct:
                raw = sct.grab(roi.as_mss_rect())
                return Image.frombytes("RGB", raw.size, raw.rgb)

        return await asyncio.to_thread(capture_once)

    async def _recognize(
        self,
        image: Image.Image,
        *,
        model_tier: str,
        language: str,
        device: str,
        cpu_threads: int,
    ) -> tuple[list[OcrLine], float]:
        image_rgb = np.array(image.convert("RGB"))
        return await asyncio.to_thread(
            self.ocr.recognize,
            image_rgb,
            model_tier=model_tier,
            language=language,
            device=device,
            cpu_threads=cpu_threads,
        )

    async def _run_loop(
        self,
        *,
        roi: Roi,
        fps: float,
        model_tier: str,
        language: str,
        device: str,
        cpu_threads: int,
        translate: bool,
    ) -> None:
        interval = 1 / fps
        last_hash: str | None = None

        while True:
            loop_started = time.perf_counter()

            try:
                image = await self._capture(roi)
                current_hash = image_change_hash(image)

                if current_hash != last_hash:
                    last_hash = current_hash
                    ocr_lines, ocr_ms = await self._recognize(
                        image,
                        model_tier=model_tier,
                        language=language,
                        device=device,
                        cpu_threads=cpu_threads,
                    )
                    await self._process_lines(ocr_lines, ocr_ms=ocr_ms, translate=translate)

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - keep the watcher alive.
                self.last_error = str(exc)
                await self.hub.broadcast(
                    {"type": "ocr.error", "payload": {"message": self.last_error}}
                )

            elapsed = time.perf_counter() - loop_started
            await asyncio.sleep(max(0.05, interval - elapsed))

    async def _process_lines(
        self,
        ocr_lines: list[OcrLine],
        *,
        ocr_ms: float,
        translate: bool,
    ) -> None:
        emitted: list[dict[str, Any]] = []

        for line in ocr_lines:
            classified = classify_line(line.text, line.confidence, line.bounds)
            key = stable_message_key(classified)

            if key in self.seen_keys:
                continue

            self.seen_keys.append(key)
            payload = classified.to_dict()
            payload["translation"] = None

            if classified.kind == "player" and translate:
                result = await self.translator.translate(
                    speaker=classified.speaker or "unknown",
                    text=classified.text,
                    context=list(self.context),
                )
                payload["translation"] = result.to_dict()

                self.context.append(
                    {
                        "speaker": classified.speaker or "unknown",
                        "text": classified.text,
                        "translatedText": result.translatedText or "",
                    }
                )

            emitted.append(payload)

        if emitted:
            await self.hub.broadcast(
                {
                    "type": "ocr.result",
                    "payload": {
                        "at": time.time(),
                        "ocrMs": round(ocr_ms, 1),
                        "messages": emitted,
                    },
                }
            )
