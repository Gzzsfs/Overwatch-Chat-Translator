from __future__ import annotations

import os
from dataclasses import dataclass

import httpx


DEFAULT_PROXY_BASE_URL = os.getenv("OCR_TRANSLATION_PROXY_URL", "http://127.0.0.1:8080")
DEFAULT_TARGET_LANG = os.getenv("OCR_TRANSLATION_TARGET_LANG", "zh-CN")
DEFAULT_DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEFAULT_DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEFAULT_DEEPSEEK_SYSTEM_PROMPT = os.getenv(
    "DEEPSEEK_SYSTEM_PROMPT",
    "你是一个精通各国语言的翻译助手，请根据我提示的内容并且结合语境进行翻译成中文，我当前在游玩一款名为守望先锋的游戏",
)


@dataclass(frozen=True)
class TranslationResult:
    ok: bool
    translatedText: str | None
    error: str | None
    model: str

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "translatedText": self.translatedText,
            "error": self.error,
            "model": self.model,
        }


class ProxyTranslator:
    def __init__(self) -> None:
        self.mode = "proxy"
        self.device_token = os.getenv("OCR_TRANSLATION_DEVICE_TOKEN", "")
        self.target_lang = DEFAULT_TARGET_LANG
        self.base_url = DEFAULT_PROXY_BASE_URL.rstrip("/")
        self.model = "proxy"

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.device_token)

    async def translate(
        self,
        *,
        speaker: str,
        text: str,
        context: list[dict[str, str]],
    ) -> TranslationResult:
        if not self.configured:
            return TranslationResult(False, None, "未登录翻译代理。", self.model)

        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.post(
                    f"{self.base_url}/v1/translate/chat",
                    headers={
                        "Authorization": f"Bearer {self.device_token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "targetLang": self.target_lang,
                        "context": [
                            {
                                "speaker": item.get("speaker", "unknown"),
                                "text": item.get("text", ""),
                                "channel": item.get("channel"),
                            }
                            for item in context[-10:]
                            if item.get("text")
                        ],
                        "message": {
                            "speaker": speaker,
                            "text": text,
                            "channel": "chat",
                        },
                    },
                )
                payload = response.json()
                if response.status_code >= 400:
                    return TranslationResult(
                        False,
                        None,
                        payload.get("message") or payload.get("error") or response.text,
                        payload.get("model") or self.model,
                    )

                translated = str(payload.get("translatedText", "")).strip()
                model = str(payload.get("model", self.model))
        except Exception as exc:  # noqa: BLE001 - surface service errors to the UI.
            return TranslationResult(False, None, str(exc), self.model)

        if not translated:
            return TranslationResult(False, None, "翻译代理返回空结果。", self.model)

        return TranslationResult(True, translated, None, model)


def build_user_prompt(
    *,
    speaker: str,
    text: str,
    context: list[dict[str, str]],
) -> str:
    recent_context = [
        f"{item.get('speaker', 'unknown')}: {item.get('text', '')}"
        for item in context[-10:]
        if item.get("text")
    ]
    return "\n".join(
        [
            "最近聊天上下文:",
            *recent_context,
            "",
            "当前要翻译:",
            f"{speaker}: {text}",
            "",
            "请只输出中文译文，不要解释。",
        ]
    )


def safe_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}


class DirectDeepSeekTranslator:
    def __init__(self) -> None:
        self.mode = "direct"
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.target_lang = DEFAULT_TARGET_LANG
        self.base_url = DEFAULT_DEEPSEEK_BASE_URL.rstrip("/")
        self.model = DEFAULT_DEEPSEEK_MODEL
        self.system_prompt = DEFAULT_DEEPSEEK_SYSTEM_PROMPT

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    async def translate(
        self,
        *,
        speaker: str,
        text: str,
        context: list[dict[str, str]],
    ) -> TranslationResult:
        if not self.configured:
            return TranslationResult(False, None, "未配置 DeepSeek API Key。", self.model)

        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "system",
                                "content": self.system_prompt,
                            },
                            {
                                "role": "user",
                                "content": build_user_prompt(
                                    speaker=speaker,
                                    text=text,
                                    context=context,
                                ),
                            },
                        ],
                        "temperature": 0.2,
                        "stream": False,
                    },
                )
                payload = safe_json(response)
                if response.status_code >= 400:
                    error_payload = payload.get("error")
                    error_message = (
                        error_payload.get("message")
                        if isinstance(error_payload, dict)
                        else None
                    )
                    return TranslationResult(
                        False,
                        None,
                        str(error_message or payload.get("message") or response.text),
                        str(payload.get("model") or self.model),
                    )

                choices = payload.get("choices")
                translated = ""
                if isinstance(choices, list) and choices:
                    first_choice = choices[0]
                    if isinstance(first_choice, dict):
                        message = first_choice.get("message")
                        if isinstance(message, dict):
                            translated = str(message.get("content", "")).strip()
                model = str(payload.get("model", self.model))
        except Exception as exc:  # noqa: BLE001 - surface service errors to the UI.
            return TranslationResult(False, None, str(exc), self.model)

        if not translated:
            return TranslationResult(False, None, "DeepSeek 返回空翻译。", self.model)

        return TranslationResult(True, translated, None, model)


def create_translator() -> ProxyTranslator | DirectDeepSeekTranslator:
    mode = os.getenv("OCR_TRANSLATION_MODE", "proxy").strip().lower()
    if mode == "direct":
        return DirectDeepSeekTranslator()
    return ProxyTranslator()
