# Overwatch Chat Translator

Windows desktop OCR overlay for translating Overwatch chat messages.

The app captures only the selected screen region, recognizes chat text with a local PaddleOCR sidecar, classifies player messages, and displays translated Chinese text in an overlay. It does not read game memory, inject code, simulate input, or upload screenshots.

## Translation Modes

- Account proxy mode: users log in to your backend proxy; DeepSeek keys stay on the server.
- Direct API mode: users enter their own DeepSeek API key locally; the key is encrypted with Electron `safeStorage`.

The built-in direct-mode system prompt is:

```text
你是一个精通各国语言的翻译助手，请根据我提示的内容并且结合语境进行翻译成中文，我当前在游玩一款名为守望先锋的游戏
```

## Development

```powershell
pnpm install
pnpm dev
```

Start with direct API mode as the default for a fresh local profile:

```powershell
pnpm dev:direct
```

Run validation:

```powershell
pnpm typecheck
pnpm compile:app
pnpm test
```

## OCR Runtime

The public Windows build is expected to bundle the CPU PaddleOCR runtime and models:

```powershell
pnpm prepare:ocr-runtime
pnpm build:integrated
```

`ocr-runtime/` and `ocr-models/` are generated artifacts and should not be committed.

## Security Notes

- Do not commit `.env`, API keys, user tokens, generated runtimes, models, or build output.
- Direct API mode sends OCR text and recent text context to DeepSeek, not screenshots.
- Proxy mode sends OCR text to your backend proxy, not screenshots.
