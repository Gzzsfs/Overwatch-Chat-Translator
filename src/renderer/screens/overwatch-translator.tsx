import {
  Activity,
  Bot,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  Monitor,
  Pin,
  PinOff,
  Play,
  Server,
  Square,
  Type,
  User,
} from 'lucide-react'
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ClassifiedOcrMessage,
  DirectDeepSeekSettingsPayload,
  GameOverlaySettings,
  OcrResultPayload,
  OcrRoi,
  OcrStatusPayload,
  OverlaySettings,
  OverwatchOcrRuntimeEvent,
  SidecarHealth,
  StartWatchPayload,
  TranslationAuthState,
  TranslationMode,
  TranslationSettingsState,
} from 'shared/overwatch-ocr'
import { cn } from 'renderer/lib/ui'

type DisplayMessage = ClassifiedOcrMessage & {
  id: string
  receivedAt: number
  ocrMs?: number
}

const DEFAULT_ROI: OcrRoi = {
  left: 40,
  top: 720,
  width: 680,
  height: 220,
}

const DEFAULT_OVERLAY: OverlaySettings = {
  alwaysOnTop: false,
  clickThrough: false,
  opacity: 0.92,
  fontSize: 15,
}

const DEFAULT_GAME_OVERLAY: GameOverlaySettings = {
  visible: false,
  alwaysOnTop: false,
  opacity: 0.82,
  fontSize: 20,
  maxMessages: 8,
}

const DEFAULT_AUTH: TranslationAuthState = {
  proxyBaseUrl: 'http://127.0.0.1:8080',
  deviceId: '',
  loggedIn: false,
  user: null,
  device: null,
  quota: null,
  message: null,
}

const DEFAULT_DEEPSEEK_SYSTEM_PROMPT =
  '你是一个精通各国语言的翻译助手，请根据我提示的内容并且结合语境进行翻译成中文，我当前在游玩一款名为守望先锋的游戏'

const DEFAULT_TRANSLATION: TranslationSettingsState = {
  mode: 'proxy',
  direct: {
    apiKeyConfigured: false,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    prompt: DEFAULT_DEEPSEEK_SYSTEM_PROMPT,
    message: null,
  },
}

function statusLabel(health: SidecarHealth | null, status: OcrStatusPayload) {
  if (status.running) {
    return '识别中'
  }

  if (health?.sidecar.status === 'error') {
    return '服务异常'
  }

  if (health?.sidecar.status === 'running') {
    return '待机'
  }

  return '未启动'
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'size-2.5 rounded-full',
        active
          ? 'bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]'
          : 'bg-zinc-500'
      )}
    />
  )
}

function compactNumber(value: number) {
  return Number.isFinite(value) ? String(Math.round(value)) : '0'
}

function messageText(message: DisplayMessage) {
  const translated = message.translation?.translatedText

  if (message.kind === 'player' && translated) {
    return translated
  }

  if (message.kind === 'player' && message.translation?.error) {
    return `翻译失败：${message.text}`
  }

  return message.text
}

export function OverwatchTranslatorScreen() {
  const [health, setHealth] = useState<SidecarHealth | null>(null)
  const [status, setStatus] = useState<OcrStatusPayload>({
    running: false,
    ocrLoaded: false,
    translatorConfigured: false,
    proxyConfigured: false,
    lastError: null,
  })
  const [auth, setAuth] = useState<TranslationAuthState>(DEFAULT_AUTH)
  const [authForm, setAuthForm] = useState({
    proxyBaseUrl: DEFAULT_AUTH.proxyBaseUrl,
    email: '',
    password: '',
  })
  const [translation, setTranslation] =
    useState<TranslationSettingsState>(DEFAULT_TRANSLATION)
  const [directForm, setDirectForm] = useState<
    DirectDeepSeekSettingsPayload & { apiKey: string }
  >({
    apiKey: '',
    baseUrl: DEFAULT_TRANSLATION.direct.baseUrl,
    model: DEFAULT_TRANSLATION.direct.model,
    prompt: DEFAULT_TRANSLATION.direct.prompt,
  })
  const [overlay, setOverlayState] = useState<OverlaySettings>(DEFAULT_OVERLAY)
  const [gameOverlay, setGameOverlay] =
    useState<GameOverlaySettings>(DEFAULT_GAME_OVERLAY)
  const [roi, setRoi] = useState<OcrRoi>(DEFAULT_ROI)
  const [fps, setFps] = useState(1)
  const [modelTier, setModelTier] =
    useState<StartWatchPayload['modelTier']>('small')
  const [ocrLanguage, setOcrLanguage] =
    useState<StartWatchPayload['language']>('auto')
  const [showSystems, setShowSystems] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const counterRef = useRef(0)
  const windowDraggingRef = useRef(false)
  const lastWindowDragAtRef = useRef(0)

  const visibleMessages = useMemo(() => {
    return messages.filter(message => showSystems || message.kind === 'player')
  }, [messages, showSystems])

  useEffect(() => {
    let mounted = true

    async function loadInitialState() {
      const [
        nextOverlay,
        nextGameOverlay,
        nextHealth,
        nextAuth,
        nextTranslation,
      ] = await Promise.all([
        window.Ocr.getOverlay(),
        window.Ocr.getGameOverlay(),
        window.Ocr.health(),
        window.Ocr.authState(),
        window.Ocr.translationState(),
      ])

      if (!mounted) {
        return
      }

      setOverlayState(nextOverlay)
      setGameOverlay(nextGameOverlay)
      setHealth(nextHealth)
      setAuth(nextAuth)
      setTranslation(nextTranslation)
      setAuthForm(current => ({
        ...current,
        proxyBaseUrl: nextAuth.proxyBaseUrl,
      }))
      setDirectForm(current => ({
        ...current,
        baseUrl: nextTranslation.direct.baseUrl,
        model: nextTranslation.direct.model,
        prompt: nextTranslation.direct.prompt,
      }))
      if (nextHealth.service?.watch) {
        setStatus(nextHealth.service.watch)
      }
    }

    loadInitialState().catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return window.Ocr.subscribeRuntimeEvents(
      (event: OverwatchOcrRuntimeEvent) => {
        if (event.type === 'ocr.status') {
          setStatus(event.payload)
        }

        if (event.type === 'ocr.error') {
          setStatus(current => ({
            ...current,
            lastError: event.payload.message,
          }))
        }

        if (event.type === 'overlay.changed') {
          setOverlayState(event.payload)
        }

        if (event.type === 'gameOverlay.changed') {
          setGameOverlay(event.payload)
        }

        if (event.type === 'sidecar.status') {
          setHealth(current => ({
            ok: event.payload.status === 'running',
            sidecar: event.payload,
            service: current?.service,
          }))
        }

        if (event.type === 'ocr.result') {
          appendMessages(event.payload)
        }
      }
    )
  }, [])

  function appendMessages(payload: OcrResultPayload) {
    setMessages(current => {
      const next = [...current]

      for (const message of payload.messages) {
        counterRef.current += 1
        next.push({
          ...message,
          id: `${payload.at}-${counterRef.current}`,
          receivedAt: payload.at,
          ocrMs: payload.ocrMs,
        })
      }

      return next.slice(-80)
    })
  }

  async function patchOverlay(patch: Partial<OverlaySettings>) {
    const next = await window.Ocr.setOverlay(patch)
    setOverlayState(next)
  }

  async function toggleClickThrough() {
    const nextClickThrough = !overlay.clickThrough
    setOverlayState(current => ({
      ...current,
      clickThrough: nextClickThrough,
    }))

    try {
      const next = await window.Ocr.setOverlay({
        clickThrough: nextClickThrough,
      })
      setOverlayState(next)
    } catch (error) {
      setOverlayState(current => ({
        ...current,
        clickThrough: !nextClickThrough,
      }))
      setHealth(current => ({
        ok: false,
        sidecar: {
          status: 'error',
          baseUrl: current?.sidecar.baseUrl ?? null,
          pythonPath: current?.sidecar.pythonPath ?? null,
          serviceDir: current?.sidecar.serviceDir ?? null,
          modelsHome: current?.sidecar.modelsHome ?? null,
          message: error instanceof Error ? error.message : String(error),
        },
        service: current?.service,
      }))
    }
  }

  async function refreshHealth() {
    const nextHealth = await window.Ocr.health()
    setHealth(nextHealth)
    if (nextHealth.service?.watch) {
      setStatus(nextHealth.service.watch)
    }
  }

  function buildWatchPayload(nextRoi = roi): StartWatchPayload {
    return {
      roi: nextRoi,
      fps,
      modelTier,
      language: ocrLanguage,
      device: 'cpu',
      cpuThreads: 6,
      translate: true,
    }
  }

  function pointerScreenPoint(event: PointerEvent<HTMLElement>) {
    return {
      screenX: Math.round(window.screenX + event.clientX),
      screenY: Math.round(window.screenY + event.clientY),
    }
  }

  function beginWindowDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement
    if (target.closest('button,input,select,textarea,a')) {
      return
    }

    windowDraggingRef.current = true
    lastWindowDragAtRef.current = 0
    event.currentTarget.setPointerCapture(event.pointerId)
    void window.Ocr.startWindowDrag(pointerScreenPoint(event))
  }

  function moveWindowDrag(event: PointerEvent<HTMLElement>) {
    if (!windowDraggingRef.current) {
      return
    }

    if ((event.buttons & 1) !== 1) {
      endWindowDrag(event)
      return
    }

    const now = performance.now()
    if (now - lastWindowDragAtRef.current < 8) {
      return
    }

    lastWindowDragAtRef.current = now
    event.preventDefault()
    void window.Ocr.moveWindowDrag(pointerScreenPoint(event))
  }

  function endWindowDrag(event: PointerEvent<HTMLElement>) {
    if (!windowDraggingRef.current) {
      return
    }

    windowDraggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    void window.Ocr.endWindowDrag()
  }

  async function start(nextRoi = roi) {
    setBusy(true)
    try {
      await window.Ocr.startWatch(buildWatchPayload(nextRoi))
      await refreshHealth()
    } catch (error) {
      setHealth(current => ({
        ok: false,
        sidecar: {
          status: 'error',
          baseUrl: current?.sidecar.baseUrl ?? null,
          pythonPath: current?.sidecar.pythonPath ?? null,
          serviceDir: current?.sidecar.serviceDir ?? null,
          modelsHome: current?.sidecar.modelsHome ?? null,
          message: error instanceof Error ? error.message : String(error),
        },
        service: current?.service,
      }))
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await window.Ocr.stopWatch()
      await refreshHealth()
    } finally {
      setBusy(false)
    }
  }

  async function selectRoi() {
    const next = await window.Ocr.selectRoi()

    if (next) {
      setRoi(next)
      if (active) {
        await start(next)
      }
    }
  }

  async function login() {
    setAuthBusy(true)
    try {
      const next = await window.Ocr.login(authForm)
      setAuth(next)
      setAuthForm(current => ({ ...current, password: '' }))
    } catch (error) {
      setAuth(current => ({
        ...current,
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setAuthBusy(false)
    }
  }

  async function logout() {
    setAuthBusy(true)
    try {
      setAuth(await window.Ocr.logout())
    } finally {
      setAuthBusy(false)
    }
  }

  async function saveProxyBaseUrl() {
    setAuthBusy(true)
    try {
      setAuth(await window.Ocr.setProxyBaseUrl(authForm.proxyBaseUrl))
    } catch (error) {
      setAuth(current => ({
        ...current,
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setAuthBusy(false)
    }
  }

  async function setTranslationMode(mode: TranslationMode) {
    setAuthBusy(true)
    try {
      setTranslation(await window.Ocr.setTranslationMode(mode))
      await refreshHealth()
    } catch (error) {
      setTranslation(current => ({
        ...current,
        direct: {
          ...current.direct,
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    } finally {
      setAuthBusy(false)
    }
  }

  async function saveDirectDeepSeek() {
    setAuthBusy(true)
    try {
      const next = await window.Ocr.setDirectDeepSeek({
        apiKey: directForm.apiKey,
        baseUrl: directForm.baseUrl,
        model: directForm.model,
        prompt: directForm.prompt,
      })
      setTranslation(next)
      setDirectForm(current => ({ ...current, apiKey: '' }))
      await refreshHealth()
    } catch (error) {
      setTranslation(current => ({
        ...current,
        direct: {
          ...current.direct,
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    } finally {
      setAuthBusy(false)
    }
  }

  async function showGameOverlay() {
    setGameOverlay(await window.Ocr.showGameOverlay())
  }

  const active = status.running
  const translatorConfigured =
    health?.service?.proxy.configured ?? status.proxyConfigured
  const translationStatus =
    translation.mode === 'direct'
      ? translation.direct.apiKeyConfigured
        ? `DeepSeek 直连已配置：${translation.direct.model}`
        : '等待 DeepSeek API Key'
      : auth.loggedIn
        ? '账号代理已登录'
        : '未登录翻译代理'
  const healthMessage =
    health?.sidecar.message ??
    (translatorConfigured ? translationStatus : '等待 OCR 服务')

  return (
    <main
      className="h-screen overflow-hidden bg-transparent p-3 text-white"
      style={{ fontSize: overlay.fontSize }}
    >
      <section className="grid h-full grid-rows-[auto_auto_1fr_auto] overflow-hidden rounded-[20px] border border-white/14 bg-zinc-950/82 shadow-[0_24px_90px_rgba(0,0,0,0.52)] backdrop-blur-2xl">
        <header
          className="flex cursor-move select-none items-center justify-between gap-3 border-b border-white/10 px-4 py-3"
          onPointerCancel={endWindowDrag}
          onPointerDown={beginWindowDrag}
          onPointerMove={moveWindowDrag}
          onPointerUp={endWindowDrag}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200/24 bg-cyan-200/12 text-cyan-100">
              <Languages className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">守望聊天翻译</h1>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <StatusDot active={active} />
                <span className="truncate">{statusLabel(health, status)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              aria-label={overlay.alwaysOnTop ? '取消固定到前台' : '固定到前台'}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-200 transition hover:bg-white/[0.12]"
              onClick={() =>
                patchOverlay({ alwaysOnTop: !overlay.alwaysOnTop })
              }
              title={overlay.alwaysOnTop ? '取消固定到前台' : '固定到前台'}
              type="button"
            >
              {overlay.alwaysOnTop ? (
                <Pin className="size-4" />
              ) : (
                <PinOff className="size-4" />
              )}
            </button>
            <button
              aria-label={
                overlay.clickThrough ? '关闭点击穿透' : '开启点击穿透'
              }
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-200 transition hover:bg-white/[0.12]"
              onClick={toggleClickThrough}
              title={overlay.clickThrough ? '关闭点击穿透' : '开启点击穿透'}
              type="button"
            >
              {overlay.clickThrough ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </header>

        <div className="grid gap-2 border-b border-white/10 p-3">
          <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.045] p-2 text-xs">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
              <button
                className={cn(
                  'min-h-8 rounded-md px-2 font-semibold transition',
                  translation.mode === 'proxy'
                    ? 'bg-cyan-300 text-zinc-950'
                    : 'text-zinc-400 hover:bg-white/[0.08]'
                )}
                disabled={authBusy}
                onClick={() => setTranslationMode('proxy')}
                type="button"
              >
                账号代理版
              </button>
              <button
                className={cn(
                  'min-h-8 rounded-md px-2 font-semibold transition',
                  translation.mode === 'direct'
                    ? 'bg-cyan-300 text-zinc-950'
                    : 'text-zinc-400 hover:bg-white/[0.08]'
                )}
                disabled={authBusy}
                onClick={() => setTranslationMode('direct')}
                type="button"
              >
                直连 API 版
              </button>
            </div>

            {translation.mode === 'proxy' ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-zinc-300">
                    <User className="size-3.5 shrink-0 text-cyan-100" />
                    <span className="truncate">
                      {auth.loggedIn ? auth.user?.email : '未登录翻译代理'}
                    </span>
                  </div>
                  {auth.loggedIn ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-zinc-200 disabled:opacity-60"
                      disabled={authBusy}
                      onClick={logout}
                      type="button"
                    >
                      <LogOut className="size-3.5" />
                      退出
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 rounded-lg bg-cyan-300 px-2 py-1 font-semibold text-zinc-950 disabled:opacity-60"
                      disabled={
                        authBusy || !authForm.email || !authForm.password
                      }
                      onClick={login}
                      type="button"
                    >
                      {authBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <LogIn className="size-3.5" />
                      )}
                      登录
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  <Server className="size-3.5 text-zinc-500" />
                  <input
                    className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                    onChange={event =>
                      setAuthForm(current => ({
                        ...current,
                        proxyBaseUrl: event.target.value,
                      }))
                    }
                    placeholder="https://api.example.com"
                    value={authForm.proxyBaseUrl}
                  />
                  <button
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 text-zinc-300 disabled:opacity-60"
                    disabled={authBusy}
                    onClick={saveProxyBaseUrl}
                    type="button"
                  >
                    保存
                  </button>
                </div>

                {!auth.loggedIn ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                      onChange={event =>
                        setAuthForm(current => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="邮箱"
                      type="email"
                      value={authForm.email}
                    />
                    <input
                      className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                      onChange={event =>
                        setAuthForm(current => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      placeholder="密码"
                      type="password"
                      value={authForm.password}
                    />
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span className="truncate">
                    {auth.message ??
                      (auth.quota
                        ? `今日 ${auth.quota.charactersToday}/${auth.quota.dailyCharacterLimit} 字符`
                        : '聊天原文不落库，只发送玩家消息文本')}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-zinc-300">
                  <div className="flex min-w-0 items-center gap-2">
                    <KeyRound className="size-3.5 shrink-0 text-cyan-100" />
                    <span className="truncate">
                      {translation.direct.apiKeyConfigured
                        ? 'DeepSeek API Key 已保存'
                        : '请输入 DeepSeek API Key'}
                    </span>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-300 px-2 py-1 font-semibold text-zinc-950 disabled:opacity-60"
                    disabled={
                      authBusy ||
                      (!translation.direct.apiKeyConfigured &&
                        !directForm.apiKey.trim())
                    }
                    onClick={saveDirectDeepSeek}
                    type="button"
                  >
                    {authBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    保存
                  </button>
                </div>

                <input
                  className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                  onChange={event =>
                    setDirectForm(current => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={
                    translation.direct.apiKeyConfigured
                      ? '已保存，留空则不修改'
                      : 'DeepSeek API Key'
                  }
                  type="password"
                  value={directForm.apiKey}
                />

                <div className="grid grid-cols-[1fr_9.5rem] gap-2">
                  <input
                    className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                    onChange={event =>
                      setDirectForm(current => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder="https://api.deepseek.com"
                    value={directForm.baseUrl}
                  />
                  <input
                    className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-zinc-100 outline-none"
                    onChange={event =>
                      setDirectForm(current => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="deepseek-v4-flash"
                    value={directForm.model}
                  />
                </div>

                <textarea
                  className="min-h-16 resize-none rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 leading-relaxed text-zinc-100 outline-none"
                  onChange={event =>
                    setDirectForm(current => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                  value={directForm.prompt}
                />

                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span className="truncate">
                    {translation.direct.message ??
                      '直连版只上传 OCR 文本，不上传截图。'}
                  </span>
                  <button
                    className="shrink-0 text-cyan-200 hover:text-cyan-100"
                    onClick={() =>
                      setDirectForm(current => ({
                        ...current,
                        prompt: DEFAULT_DEEPSEEK_SYSTEM_PROMPT,
                      }))
                    }
                    type="button"
                  >
                    恢复默认提示词
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || active}
              onClick={() => start()}
              type="button"
            >
              {busy && !active ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              开始识别
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !active}
              onClick={stop}
              type="button"
            >
              <Square className="size-4" />
              停止
            </button>
          </div>

          <button
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-cyan-200/18 bg-cyan-200/[0.075] px-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/[0.14]"
            onClick={showGameOverlay}
            type="button"
          >
            <Monitor className="size-4" />
            {gameOverlay.visible ? '游戏模式已打开' : '打开游戏模式'}
          </button>

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <button
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/[0.12]"
              onClick={selectRoi}
              type="button"
            >
              <Crosshair className="size-4" />
              框选区域
            </button>
            <select
              className="min-h-9 w-24 rounded-xl border border-white/12 bg-zinc-950 px-2 text-xs text-white outline-none"
              onChange={event =>
                setOcrLanguage(
                  event.target.value as StartWatchPayload['language']
                )
              }
              value={ocrLanguage}
            >
              <option value="auto">auto</option>
              <option value="ch">中文</option>
              <option value="en">英文</option>
              <option value="korean">韩文</option>
              <option value="japan">日文</option>
            </select>
            <select
              className="min-h-9 w-24 rounded-xl border border-white/12 bg-zinc-950 px-2 text-xs text-white outline-none"
              onChange={event =>
                setModelTier(
                  event.target.value as StartWatchPayload['modelTier']
                )
              }
              value={modelTier}
            >
              <option value="tiny">tiny</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="mb-1 flex items-center gap-2 text-zinc-400">
                <Activity className="size-3.5" />
                FPS {fps.toFixed(1)}
              </span>
              <input
                className="w-full accent-cyan-300"
                max={3}
                min={0.2}
                onChange={event => setFps(Number(event.target.value))}
                step={0.2}
                type="range"
                value={fps}
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
              <span className="mb-1 flex items-center gap-2 text-zinc-400">
                <Type className="size-3.5" />
                字号 {overlay.fontSize}
              </span>
              <input
                className="w-full accent-cyan-300"
                max={22}
                min={12}
                onChange={event =>
                  patchOverlay({ fontSize: Number(event.target.value) })
                }
                step={1}
                type="range"
                value={overlay.fontSize}
              />
            </label>
          </div>

          <div className="grid grid-cols-4 gap-2 text-xs text-zinc-300">
            <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2">
              X {compactNumber(roi.left)}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2">
              Y {compactNumber(roi.top)}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2">
              W {compactNumber(roi.width)}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2">
              H {compactNumber(roi.height)}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-auto px-3 py-3">
          {visibleMessages.length === 0 ? (
            <div className="grid h-full min-h-[240px] place-items-center rounded-2xl border border-dashed border-white/12 bg-white/[0.035] text-center text-sm text-zinc-500">
              <div>
                <MessageSquare className="mx-auto mb-3 size-8 text-zinc-600" />
                等待聊天消息
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleMessages
                .slice()
                .reverse()
                .map(message => {
                  const isPlayer = message.kind === 'player'
                  return (
                    <article
                      className={cn(
                        'rounded-2xl border p-3',
                        isPlayer
                          ? 'border-cyan-200/18 bg-cyan-200/[0.075]'
                          : 'border-white/10 bg-white/[0.035] text-zinc-400'
                      )}
                      key={message.id}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {isPlayer ? (
                            <Bot className="size-4 shrink-0 text-cyan-100" />
                          ) : (
                            <MessageSquare className="size-4 shrink-0 text-zinc-500" />
                          )}
                          <span className="truncate text-xs font-semibold text-zinc-300">
                            {message.speaker ?? message.kind}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          {Math.round(message.confidence * 100)}%
                        </span>
                      </div>
                      <p className="break-words text-sm leading-relaxed text-white">
                        {messageText(message)}
                      </p>
                      {isPlayer && message.translation?.translatedText ? (
                        <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">
                          {message.text}
                        </p>
                      ) : null}
                    </article>
                  )
                })}
            </div>
          )}
        </div>

        <footer className="grid gap-2 border-t border-white/10 p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2 py-1.5 text-zinc-300"
              onClick={() => setShowSystems(value => !value)}
              type="button"
            >
              {showSystems ? (
                <Check className="size-3.5" />
              ) : (
                <MessageSquare className="size-3.5" />
              )}
              系统消息
            </button>
            <span className="truncate">{healthMessage}</span>
          </div>

          <label className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs text-zinc-400">
            <span>透明度</span>
            <input
              className="accent-cyan-300"
              max={1}
              min={0.35}
              onChange={event =>
                patchOverlay({ opacity: Number(event.target.value) })
              }
              step={0.05}
              type="range"
              value={overlay.opacity}
            />
            <span>{Math.round(overlay.opacity * 100)}%</span>
          </label>
        </footer>
      </section>
    </main>
  )
}
