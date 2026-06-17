from __future__ import annotations

import base64
import io
import os
from typing import Any

import numpy as np
from fastapi import FastAPI, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

from classifier import classify_line
from ocr_engine import PaddleOcrEngine
from translator import create_translator
from watcher import EventHub, WatchManager


class RoiPayload(BaseModel):
    left: int = 40
    top: int = 720
    width: int = Field(default=680, gt=10)
    height: int = Field(default=220, gt=10)


class WatchStartPayload(BaseModel):
    roi: RoiPayload
    fps: float = Field(default=1.0, ge=0.2, le=5.0)
    modelTier: str = "small"
    language: str = "auto"
    device: str = "cpu"
    cpuThreads: int = Field(default=6, ge=1, le=16)
    translate: bool = True


class ImageOcrPayload(BaseModel):
    imageBase64: str
    modelTier: str = "small"
    language: str = "auto"
    device: str = "cpu"
    cpuThreads: int = Field(default=6, ge=1, le=16)


app = FastAPI(
    title="Overwatch Chat OCR Translator",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

hub = EventHub()
watch_manager = WatchManager(hub)
single_ocr = PaddleOcrEngine()


def dependency_status() -> dict[str, bool]:
    status: dict[str, bool] = {}
    for module_name in ["paddleocr", "paddle", "mss", "PIL", "httpx", "numpy"]:
        try:
            __import__(module_name)
            status[module_name] = True
        except Exception:
            status[module_name] = False
    return status


def image_from_base64(payload: str) -> Image.Image:
    raw = payload.split(",", 1)[-1]
    data = base64.b64decode(raw)
    return Image.open(io.BytesIO(data)).convert("RGB")


async def run_single_ocr(image: Image.Image, payload: dict[str, Any]) -> dict[str, Any]:
    lines, elapsed_ms = await watch_manager._recognize(  # noqa: SLF001 - same service path.
        image,
        model_tier=str(payload.get("modelTier", "small")),
        language=str(payload.get("language", "auto")),
        device=str(payload.get("device", "cpu")),
        cpu_threads=int(payload.get("cpuThreads", 6)),
    )
    messages = [
        classify_line(line.text, line.confidence, line.bounds).to_dict()
        for line in lines
    ]
    return {"ocrMs": round(elapsed_ms, 1), "messages": messages}


@app.get("/health")
async def health() -> dict[str, Any]:
    translator = create_translator()
    return {
        "ok": True,
        "pid": os.getpid(),
        "dependencies": dependency_status(),
        "watch": watch_manager.status(),
        "proxy": {
            "configured": translator.configured,
            "baseUrl": translator.base_url,
            "targetLang": translator.target_lang,
            "mode": translator.mode,
            "model": translator.model,
        },
    }


@app.post("/watch/start")
async def start_watch(payload: WatchStartPayload) -> dict[str, Any]:
    return await watch_manager.start(payload.model_dump())


@app.post("/watch/stop")
async def stop_watch() -> dict[str, Any]:
    return await watch_manager.stop()


@app.post("/ocr/image")
async def ocr_image(payload: ImageOcrPayload) -> dict[str, Any]:
    image = image_from_base64(payload.imageBase64)
    return await run_single_ocr(image, payload.model_dump())


@app.post("/ocr/upload")
async def ocr_upload(file: UploadFile) -> dict[str, Any]:
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    lines, elapsed_ms = single_ocr.recognize(np.array(image), language="auto")
    return {
        "ocrMs": round(elapsed_ms, 1),
        "messages": [
            classify_line(line.text, line.confidence, line.bounds).to_dict()
            for line in lines
        ],
    }


@app.websocket("/events")
async def events(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)
