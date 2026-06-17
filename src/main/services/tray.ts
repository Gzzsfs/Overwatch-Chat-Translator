import {
  app,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type Event as ElectronEvent,
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { displayName } from '~/package.json'

interface OverwatchTrayOptions {
  onHidePanel(): void
  onShowPanel(): void
  onBeforeQuit(): void
}

export class OverwatchTrayService {
  private tray: Tray | null = null
  private allowQuit = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: OverwatchTrayOptions
  ) {}

  start() {
    this.createTray()
    this.window.on('close', event => this.handleWindowClose(event))
    this.window.on('show', () => this.createMenu())
    this.window.on('hide', () => this.createMenu())
  }

  allowAppQuit() {
    this.allowQuit = true
  }

  dispose() {
    this.tray?.destroy()
    this.tray = null
  }

  private handleWindowClose(event: ElectronEvent) {
    if (this.allowQuit) {
      return
    }

    event.preventDefault()
    this.hidePanel()
  }

  private showPanel() {
    if (this.window.isDestroyed()) {
      return
    }

    if (this.window.isMinimized()) {
      this.window.restore()
    }
    this.window.show()
    this.window.focus()
    this.options.onShowPanel()
    this.createMenu()
  }

  private hidePanel() {
    if (this.window.isDestroyed()) {
      return
    }

    this.options.onHidePanel()
    this.window.hide()
    this.createMenu()
  }

  private quit() {
    this.allowQuit = true
    this.options.onBeforeQuit()
    this.dispose()
    app.quit()
  }

  private createTray() {
    if (this.tray) {
      return
    }

    this.tray = new Tray(resolveTrayIcon())
    this.tray.setToolTip(displayName)
    this.tray.on('double-click', () => this.showPanel())
    this.createMenu()
  }

  private createMenu() {
    if (!this.tray) {
      return
    }

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: this.window.isVisible() ? '隐藏面板' : '显示面板',
          click: () => {
            if (this.window.isVisible()) {
              this.hidePanel()
            } else {
              this.showPanel()
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => this.quit(),
        },
      ])
    )
  }
}

function resolveTrayIcon() {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'build', 'icons', 'icon.ico'),
        join(process.resourcesPath, 'icon.ico'),
      ]
    : [join(app.getAppPath(), 'src', 'resources', 'build', 'icons', 'icon.ico')]

  const iconPath = candidates.find(candidate => existsSync(candidate))
  if (!iconPath) {
    return nativeImage.createEmpty()
  }

  const icon = nativeImage.createFromPath(iconPath)
  return icon.isEmpty() ? nativeImage.createEmpty() : icon
}
