import {
  GripHorizontal,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Type,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  ClassifiedOcrMessage,
  GameOverlaySettings,
  OcrResultPayload,
  OverwatchOcrRuntimeEvent,
} from 'shared/overwatch-ocr'
import { cn } from 'renderer/lib/ui'

type GameMessage = ClassifiedOcrMessage & {
  id: string
  receivedAt: number
}

const DEFAULT_GAME_OVERLAY: GameOverlaySettings = {
  visible: true,
  alwaysOnTop: false,
  opacity: 0.82,
  fontSize: 20,
  maxMessages: 8,
}

function translatedLine(message: GameMessage) {
  return message.translation?.translatedText || message.text
}

function appendPayload(
  current: GameMessage[],
  payload: OcrResultPayload,
  maxMessages: number
) {
  const next = [...current]

  payload.messages
    .filter(message => message.kind === 'player')
    .forEach((message, index) => {
      next.push({
        ...message,
        id: `${payload.at}-${index}-${message.rawLine}`,
        receivedAt: payload.at,
      })
    })

  return next.slice(-maxMessages)
}

export function GameOverlayScreen() {
  const [settings, setSettings] =
    useState<GameOverlaySettings>(DEFAULT_GAME_OVERLAY)
  const [messages, setMessages] = useState<GameMessage[]>([])
  const windowDraggingRef = useRef(false)
  const windowResizingRef = useRef(false)
  const lastWindowMoveAtRef = useRef(0)

  const orderedMessages = useMemo(
    () => messages.slice(-settings.maxMessages),
    [messages, settings.maxMessages]
  )

  useEffect(() => {
    document.body.classList.add('game-overlay-mode')

    window.Ocr.getGameOverlay()
      .then(next => setSettings(next))
      .catch(() => undefined)

    return () => {
      document.body.classList.remove('game-overlay-mode')
    }
  }, [])

  useEffect(() => {
    return window.Ocr.subscribeRuntimeEvents(
      (event: OverwatchOcrRuntimeEvent) => {
        if (event.type === 'gameOverlay.changed') {
          setSettings(event.payload)
        }

        if (event.type === 'ocr.result') {
          setMessages(current =>
            appendPayload(current, event.payload, settings.maxMessages)
          )
        }
      }
    )
  }, [settings.maxMessages])

  async function patchSettings(patch: Partial<GameOverlaySettings>) {
    setSettings(await window.Ocr.setGameOverlay(patch))
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
    lastWindowMoveAtRef.current = 0
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
    if (now - lastWindowMoveAtRef.current < 8) {
      return
    }

    lastWindowMoveAtRef.current = now
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

  function beginWindowResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return
    }

    windowResizingRef.current = true
    lastWindowMoveAtRef.current = 0
    event.currentTarget.setPointerCapture(event.pointerId)
    void window.Ocr.startWindowResize(pointerScreenPoint(event))
  }

  function moveWindowResize(event: PointerEvent<HTMLButtonElement>) {
    if (!windowResizingRef.current) {
      return
    }

    if ((event.buttons & 1) !== 1) {
      endWindowResize(event)
      return
    }

    const now = performance.now()
    if (now - lastWindowMoveAtRef.current < 8) {
      return
    }

    lastWindowMoveAtRef.current = now
    event.preventDefault()
    void window.Ocr.moveWindowResize(pointerScreenPoint(event))
  }

  function endWindowResize(event: PointerEvent<HTMLButtonElement>) {
    if (!windowResizingRef.current) {
      return
    }

    windowResizingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    void window.Ocr.endWindowResize()
  }

  return (
    <main
      className="h-screen overflow-hidden bg-transparent text-white"
      style={
        {
          '--game-font-size': `${settings.fontSize}px`,
        } as CSSProperties
      }
    >
      <section className="relative grid h-full grid-rows-[auto_1fr] overflow-hidden rounded-lg border border-white/16 bg-zinc-950/70 shadow-[0_18px_70px_rgba(0,0,0,0.38)] backdrop-blur-md">
        <header
          className="group flex min-h-8 cursor-move select-none items-center gap-1 border-b border-white/10 bg-black/24 px-2"
          onPointerCancel={endWindowDrag}
          onPointerDown={beginWindowDrag}
          onPointerMove={moveWindowDrag}
          onPointerUp={endWindowDrag}
        >
          <GripHorizontal className="size-4 shrink-0 text-cyan-100/80" />
          <div className="min-w-0 flex-1" />
          <button
            className="grid size-7 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-white"
            onClick={() =>
              patchSettings({ alwaysOnTop: !settings.alwaysOnTop })
            }
            title={settings.alwaysOnTop ? '取消置顶' : '固定到前台'}
            type="button"
          >
            {settings.alwaysOnTop ? (
              <Pin className="size-4" />
            ) : (
              <PinOff className="size-4" />
            )}
          </button>
          <label
            className="flex h-7 w-24 items-center gap-1 rounded-md px-1 text-zinc-300 hover:bg-white/10"
            title="透明度"
          >
            <Minus className="size-3.5 shrink-0" />
            <input
              aria-label="透明度"
              className="w-full accent-cyan-300"
              max={1}
              min={0.25}
              onChange={event =>
                patchSettings({ opacity: Number(event.target.value) })
              }
              step={0.05}
              type="range"
              value={settings.opacity}
            />
          </label>
          <label
            className="flex h-7 w-24 items-center gap-1 rounded-md px-1 text-zinc-300 hover:bg-white/10"
            title="字号"
          >
            <Type className="size-3.5 shrink-0" />
            <input
              aria-label="字号"
              className="w-full accent-cyan-300"
              max={34}
              min={12}
              onChange={event =>
                patchSettings({ fontSize: Number(event.target.value) })
              }
              step={1}
              type="range"
              value={settings.fontSize}
            />
          </label>
          <button
            className="grid size-7 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-white"
            onClick={() => window.Ocr.hideGameOverlay()}
            title="关闭游戏模式"
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 overflow-hidden px-3 py-2">
          {orderedMessages.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-[clamp(12px,3.2vw,16px)] text-zinc-400/80">
              <span>等待翻译</span>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-end gap-1.5 overflow-hidden">
              {orderedMessages.map(message => (
                <p
                  className={cn(
                    'min-w-0 break-words rounded-md border border-white/10 bg-black/22 px-2 py-1 leading-tight text-white shadow-[0_2px_18px_rgba(0,0,0,0.22)]',
                    '[font-size:clamp(12px,min(3.7vw,9vh),var(--game-font-size))]'
                  )}
                  key={message.id}
                >
                  <span className="mr-1 font-semibold text-cyan-100">
                    {message.speaker ?? 'player'}:
                  </span>
                  <span>{translatedLine(message)}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        <button
          className="absolute right-1 bottom-1 grid size-6 cursor-nwse-resize place-items-center rounded-md border border-white/10 bg-black/40 text-zinc-300 hover:bg-white/12 hover:text-white"
          onPointerCancel={endWindowResize}
          onPointerDown={beginWindowResize}
          onPointerMove={moveWindowResize}
          onPointerUp={endWindowResize}
          title="调整大小"
          type="button"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </section>
    </main>
  )
}
