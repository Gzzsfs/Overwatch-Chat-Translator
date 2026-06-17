import { BrowserWindow } from 'electron'
import { join } from 'node:path'

import { createWindow } from 'lib/electron-app/factories/windows/create'
import {
  OVERWATCH_OCR_CHANNELS,
  type GameOverlaySettings,
} from 'shared/overwatch-ocr'

const DEFAULT_GAME_OVERLAY: GameOverlaySettings = {
  visible: false,
  alwaysOnTop: false,
  opacity: 0.82,
  fontSize: 20,
  maxMessages: 8,
}

export class GameOverlayWindowService {
  private window: BrowserWindow | null = null
  private settings: GameOverlaySettings = DEFAULT_GAME_OVERLAY
  private lastBounds = {
    width: 520,
    height: 190,
  }

  getSettings() {
    return this.settings
  }

  show() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      this.settings = { ...this.settings, visible: true }
      this.applySettings()
      return this.settings
    }

    this.window = createWindow({
      id: 'game',
      width: this.lastBounds.width,
      height: this.lastBounds.height,
      minWidth: 280,
      minHeight: 120,
      show: false,
      center: true,
      frame: false,
      movable: true,
      resizable: true,
      alwaysOnTop: this.settings.alwaysOnTop,
      transparent: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
      },
    })

    this.window.on('close', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.lastBounds = this.window.getBounds()
      }
    })

    this.window.on('closed', () => {
      this.window = null
      this.settings = { ...this.settings, visible: false }
      this.emitSettings()
    })

    this.window.webContents.on('did-finish-load', () => {
      if (!this.window || this.window.isDestroyed()) {
        return
      }

      this.settings = { ...this.settings, visible: true }
      this.applySettings()
      this.window.show()
    })

    return this.settings
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.lastBounds = this.window.getBounds()
      this.window.hide()
    }

    this.settings = { ...this.settings, visible: false }
    this.emitSettings()
    return this.settings
  }

  setSettings(patch: Partial<GameOverlaySettings>) {
    this.settings = {
      ...this.settings,
      ...patch,
      opacity: clamp(patch.opacity ?? this.settings.opacity, 0.25, 1),
      fontSize: Math.round(
        clamp(patch.fontSize ?? this.settings.fontSize, 12, 34)
      ),
      maxMessages: Math.round(
        clamp(patch.maxMessages ?? this.settings.maxMessages, 2, 20)
      ),
    }

    if (patch.visible === true) {
      return this.show()
    }

    if (patch.visible === false) {
      return this.hide()
    }

    this.applySettings()
    return this.settings
  }

  dispose() {
    if (this.window && !this.window.isDestroyed()) {
      this.lastBounds = this.window.getBounds()
      this.window.close()
    }
    this.window = null
    this.settings = { ...this.settings, visible: false }
  }

  private applySettings() {
    if (!this.window || this.window.isDestroyed()) {
      this.emitSettings()
      return
    }

    this.window.setOpacity(this.settings.opacity)
    if (this.settings.alwaysOnTop) {
      this.window.setAlwaysOnTop(true, 'screen-saver')
    } else {
      this.window.setAlwaysOnTop(false)
    }
    this.emitSettings()
  }

  private emitSettings() {
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (!candidate.isDestroyed()) {
        candidate.webContents.send(OVERWATCH_OCR_CHANNELS.runtimeEvent, {
          type: 'gameOverlay.changed',
          payload: this.settings,
        })
      }
    }
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.max(min, Math.min(max, value))
}
