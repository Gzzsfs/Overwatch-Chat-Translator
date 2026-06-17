import { BrowserWindow, ipcMain, screen } from 'electron'

import { createWindow } from 'lib/electron-app/factories/windows/create'
import {
  OVERWATCH_OCR_CHANNELS,
  type DirectDeepSeekSettingsPayload,
  type GameOverlaySettings,
  type OcrRoi,
  type OverlaySettings,
  type StartWatchPayload,
  type TranslationLoginPayload,
  type TranslationMode,
  type WindowDragPoint,
} from 'shared/overwatch-ocr'
import {
  normalizeRoi,
  type OverwatchOcrSidecar,
} from './services/overwatch-ocr-sidecar'
import type { GameOverlayWindowService } from './services/game-overlay-window'
import type { TranslationAuthService } from './services/translation-auth'

let selectionWindow: BrowserWindow | null = null
let selectionResolve: ((roi: OcrRoi | null) => void) | null = null
let selectionPromise: Promise<OcrRoi | null> | null = null
let roiBorderWindow: BrowserWindow | null = null
let currentRoi: OcrRoi | null = null
let windowDrag: {
  window: BrowserWindow
  startPoint: WindowDragPoint
  startBounds: Electron.Rectangle
} | null = null
let windowResize: {
  window: BrowserWindow
  startPoint: WindowDragPoint
  startBounds: Electron.Rectangle
} | null = null

function allDisplaysBounds() {
  const displays = screen.getAllDisplays()
  const left = Math.min(...displays.map(display => display.bounds.x))
  const top = Math.min(...displays.map(display => display.bounds.y))
  const right = Math.max(
    ...displays.map(display => display.bounds.x + display.bounds.width)
  )
  const bottom = Math.max(
    ...displays.map(display => display.bounds.y + display.bounds.height)
  )

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

async function openRoiSelector() {
  if (selectionWindow) {
    selectionWindow.focus()
    return selectionPromise
  }

  const bounds = allDisplaysBounds()
  selectionWindow = createWindow({
    id: 'selector',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
    },
  })
  selectionWindow.setAlwaysOnTop(true, 'screen-saver')

  selectionWindow.on('closed', () => {
    selectionWindow = null
    selectionResolve?.(null)
    selectionResolve = null
  })

  selectionPromise = new Promise<OcrRoi | null>(resolve => {
    selectionResolve = resolve
  })
  return selectionPromise
}

function finishSelection(roi: OcrRoi | null) {
  const resolve = selectionResolve
  selectionResolve = null
  selectionPromise = null
  resolve?.(roi)

  if (selectionWindow && !selectionWindow.isDestroyed()) {
    selectionWindow.close()
  }
  selectionWindow = null
}

function showRoiBorder(roi: OcrRoi) {
  const normalized = normalizeRoi(roi)
  currentRoi = normalized
  const bounds = {
    x: normalized.left,
    y: normalized.top,
    width: Math.max(24, normalized.width),
    height: Math.max(24, normalized.height),
  }

  if (roiBorderWindow && !roiBorderWindow.isDestroyed()) {
    roiBorderWindow.setBounds(bounds)
    roiBorderWindow.showInactive()
    return
  }

  roiBorderWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
  })
  roiBorderWindow.setAlwaysOnTop(true, 'screen-saver')
  roiBorderWindow.setIgnoreMouseEvents(true, { forward: true })
  roiBorderWindow.on('closed', () => {
    roiBorderWindow = null
  })
  roiBorderWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            html, body {
              width: 100%;
              height: 100%;
              margin: 0;
              overflow: hidden;
              background: transparent;
            }

            .border {
              position: fixed;
              inset: 2px;
              border: 2px solid rgba(103, 232, 249, 0.95);
              box-shadow:
                inset 0 0 0 1px rgba(8, 47, 73, 0.95),
                0 0 0 1px rgba(8, 47, 73, 0.95),
                0 0 18px rgba(34, 211, 238, 0.72);
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="border"></div>
        </body>
      </html>
    `)}`
  )
}

export function hideOverwatchOcrAuxiliaryWindows() {
  finishSelection(null)

  if (roiBorderWindow && !roiBorderWindow.isDestroyed()) {
    roiBorderWindow.close()
  }
  roiBorderWindow = null
}

export function restoreOverwatchOcrAuxiliaryWindows() {
  if (currentRoi) {
    showRoiBorder(currentRoi)
  }
}

export function disposeOverwatchOcrAuxiliaryWindows() {
  currentRoi = null
  hideOverwatchOcrAuxiliaryWindows()
}

function isValidDragPoint(point: WindowDragPoint) {
  return Number.isFinite(point.screenX) && Number.isFinite(point.screenY)
}

export function registerOverwatchOcrIpc(
  sidecar: OverwatchOcrSidecar,
  auth: TranslationAuthService,
  gameOverlay: GameOverlayWindowService
) {
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.health, () => sidecar.health())
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.startWatch,
    (_, payload: StartWatchPayload) => {
      showRoiBorder(payload.roi)
      return sidecar.startWatch(payload)
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.stopWatch, () => sidecar.stopWatch())
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.getOverlay, () => sidecar.getOverlay())
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.setOverlay,
    (_, payload: Partial<OverlaySettings>) => sidecar.setOverlay(payload)
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.authState, () => auth.refresh())
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.authLogin,
    async (_, payload: TranslationLoginPayload) => {
      const state = await auth.login(payload)
      sidecar.dispose()
      return state
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.authLogout, async () => {
    const state = await auth.logout()
    sidecar.dispose()
    return state
  })
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.authSetProxy, (_, payload: string) => {
    const state = auth.setProxyBaseUrl(payload)
    sidecar.dispose()
    return state
  })
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.translationState, () =>
    auth.getTranslationState()
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.translationSetMode,
    (_, payload: TranslationMode) => {
      const state = auth.setTranslationMode(payload)
      sidecar.dispose()
      return state
    }
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.translationSetDirectDeepSeek,
    (_, payload: DirectDeepSeekSettingsPayload) => {
      const state = auth.setDirectDeepSeekSettings(payload)
      sidecar.dispose()
      return state
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.showGameOverlay, () =>
    gameOverlay.show()
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.hideGameOverlay, () =>
    gameOverlay.hide()
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.getGameOverlay, () =>
    gameOverlay.getSettings()
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.setGameOverlay,
    (_, payload: Partial<GameOverlaySettings>) =>
      gameOverlay.setSettings(payload)
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.windowDragStart,
    (event, payload: WindowDragPoint) => {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)

      if (!sourceWindow || sourceWindow.isDestroyed()) {
        return false
      }

      if (!isValidDragPoint(payload)) {
        return false
      }

      windowDrag = {
        window: sourceWindow,
        startPoint: payload,
        startBounds: sourceWindow.getBounds(),
      }
      return true
    }
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.windowDragMove,
    (_, payload: WindowDragPoint) => {
      if (!windowDrag || windowDrag.window.isDestroyed()) {
        return false
      }

      if (!isValidDragPoint(payload)) {
        return false
      }

      const x = Math.round(
        windowDrag.startBounds.x +
          payload.screenX -
          windowDrag.startPoint.screenX
      )
      const y = Math.round(
        windowDrag.startBounds.y +
          payload.screenY -
          windowDrag.startPoint.screenY
      )

      windowDrag.window.setBounds({
        ...windowDrag.startBounds,
        x,
        y,
      })
      return true
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.windowDragEnd, () => {
    windowDrag = null
    return true
  })
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.windowResizeStart,
    (event, payload: WindowDragPoint) => {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)

      if (!sourceWindow || sourceWindow.isDestroyed()) {
        return false
      }

      if (!isValidDragPoint(payload)) {
        return false
      }

      windowResize = {
        window: sourceWindow,
        startPoint: payload,
        startBounds: sourceWindow.getBounds(),
      }
      return true
    }
  )
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.windowResizeMove,
    (_, payload: WindowDragPoint) => {
      if (!windowResize || windowResize.window.isDestroyed()) {
        return false
      }

      if (!isValidDragPoint(payload)) {
        return false
      }

      const width = Math.max(
        280,
        Math.round(
          windowResize.startBounds.width +
            payload.screenX -
            windowResize.startPoint.screenX
        )
      )
      const height = Math.max(
        120,
        Math.round(
          windowResize.startBounds.height +
            payload.screenY -
            windowResize.startPoint.screenY
        )
      )

      windowResize.window.setBounds({
        ...windowResize.startBounds,
        width,
        height,
      })
      return true
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.windowResizeEnd, () => {
    windowResize = null
    return true
  })
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.selectRoi, async () => {
    const roi = await openRoiSelector()
    return roi
  })
  ipcMain.handle(
    OVERWATCH_OCR_CHANNELS.completeRoiSelection,
    (_, payload: OcrRoi) => {
      const roi = normalizeRoi(payload)
      showRoiBorder(roi)
      finishSelection(roi)
      return true
    }
  )
  ipcMain.handle(OVERWATCH_OCR_CHANNELS.cancelRoiSelection, () => {
    finishSelection(null)
    return true
  })
}
