import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { OcrRoi } from 'shared/overwatch-ocr'

function normalizeRect(start: Point, end: Point): OcrRoi {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

interface Point {
  x: number
  y: number
}

export function RoiSelectorScreen() {
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)

  useEffect(() => {
    document.body.classList.add('roi-selector-mode')

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.Ocr.cancelRoiSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('roi-selector-mode')
    }
  }, [])

  const rect = useMemo(() => {
    if (!start || !current) {
      return null
    }

    return normalizeRect(start, current)
  }, [start, current])

  return (
    <main
      className="relative h-screen cursor-crosshair overflow-hidden bg-black/[0.08] text-white"
      onMouseDown={event => {
        const point = {
          x: window.screenX + event.clientX,
          y: window.screenY + event.clientY,
        }
        setStart(point)
        setCurrent(point)
      }}
      onMouseMove={event => {
        if (start) {
          setCurrent({
            x: window.screenX + event.clientX,
            y: window.screenY + event.clientY,
          })
        }
      }}
      onMouseUp={event => {
        if (!start) {
          return
        }

        const selected = normalizeRect(start, {
          x: window.screenX + event.clientX,
          y: window.screenY + event.clientY,
        })

        if (selected.width >= 24 && selected.height >= 24) {
          window.Ocr.completeRoiSelection(selected)
        } else {
          window.Ocr.cancelRoiSelection()
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 border border-cyan-200/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]" />
      <button
        className="absolute right-4 top-4 flex size-10 cursor-pointer items-center justify-center rounded-xl border border-white/18 bg-black/55 text-white shadow-2xl backdrop-blur"
        onClick={() => window.Ocr.cancelRoiSelection()}
        type="button"
      >
        <X className="size-5" />
      </button>

      {rect ? (
        <div
          className="pointer-events-none absolute border-2 border-cyan-200 bg-cyan-200/[0.06] shadow-[0_0_0_9999px_rgba(0,0,0,0.14),0_12px_44px_rgba(34,211,238,0.3)]"
          style={{
            left: rect.left - window.screenX,
            top: rect.top - window.screenY,
            width: rect.width,
            height: rect.height,
          }}
        >
          <div className="absolute -top-8 left-0 rounded-lg bg-cyan-200 px-2 py-1 text-xs font-semibold text-zinc-950">
            {rect.width} x {rect.height}
          </div>
        </div>
      ) : null}
    </main>
  )
}
