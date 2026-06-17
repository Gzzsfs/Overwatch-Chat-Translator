# Overwatch OCR Sidecar

本目录是守望先锋聊天翻译悬浮工具的本地 Python OCR/翻译服务。

## 内置集成

发布给用户前，先在项目根目录准备内置 PaddleOCR 运行时：

```powershell
pnpm prepare:ocr-runtime
pnpm build
```

这会生成两个本地构建产物：

- `ocr-runtime`：内置 Python + PaddleOCR + FastAPI 依赖。
- `ocr-models`：预热后的 PaddleOCR tiny/small 模型缓存。

打包时 Electron 会把这两个目录复制进应用资源。运行时主进程会优先使用内置 `ocr-runtime\Scripts\python.exe`，并把模型复制到应用用户数据目录，避免用户手动安装 Python/PaddleOCR。

如果只想快速开发，也可以指定现有 Python：

```powershell
$env:OVERWATCH_OCR_PYTHON="D:\path\to\python.exe"
```

准备运行时时可以指定构建用 Python：

```powershell
$env:OVERWATCH_OCR_BUILD_PYTHON="D:\path\to\python.exe"
pnpm prepare:ocr-runtime
```

只重新安装依赖不预热模型：

```powershell
pnpm prepare:ocr-runtime -- -SkipModelWarmup
```

预热更多模型档位：

```powershell
pnpm prepare:ocr-runtime -- -ModelTier tiny,small,medium
```

翻译由 Electron 主进程注入代理配置。用户在客户端登录后，sidecar 会收到：

```powershell
$env:OCR_TRANSLATION_PROXY_URL="https://your-proxy.example.com"
$env:OCR_TRANSLATION_DEVICE_TOKEN="..."
$env:OCR_TRANSLATION_TARGET_LANG="zh-CN"
```

开发时也可以手动设置以上环境变量。DeepSeek API Key 只配置在 `server/` 后端代理，不写入客户端或安装包。


## 接口

- `GET /health`
- `POST /watch/start`
- `POST /watch/stop`
- `POST /ocr/image`
- `POST /ocr/upload`
- `WS /events`

## 分类规则

第一版只把有效的 `[玩家昵称]: 消息内容` 识别为玩家消息并翻译。没有有效括号和冒号前缀、空文本、低置信度行和常见 UI 提示默认视为系统消息或 unknown，不触发翻译。

## 安全边界

该服务只做屏幕 ROI 截图 OCR 和独立悬浮窗展示，不读取守望先锋进程内存，不注入 DLL，不模拟键鼠，也不自动写入游戏聊天框。翻译代理请求只发送 OCR 得到的玩家消息文本、昵称和最近聊天上下文，不上传截图。
