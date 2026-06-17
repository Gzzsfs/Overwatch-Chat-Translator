import { app, globalShortcut } from 'electron'

import { makeAppWithSingleInstanceLock } from 'lib/electron-app/factories/app/instance'
import { makeAppSetup } from 'lib/electron-app/factories/app/setup'
import { loadReactDevtools } from 'lib/electron-app/utils'
import { ENVIRONMENT } from 'shared/constants'
import { waitFor } from 'shared/utils'
import {
  disposeOverwatchOcrAuxiliaryWindows,
  hideOverwatchOcrAuxiliaryWindows,
  registerOverwatchOcrIpc,
  restoreOverwatchOcrAuxiliaryWindows,
} from './register-overwatch-ocr-ipc'
import { GameOverlayWindowService } from './services/game-overlay-window'
import { OverwatchOcrSidecar } from './services/overwatch-ocr-sidecar'
import { TranslationAuthService } from './services/translation-auth'
import { OverwatchTrayService } from './services/tray'
import { MainWindow } from './windows/main'

makeAppWithSingleInstanceLock(async () => {
  await app.whenReady()
  const window = await makeAppSetup(MainWindow)
  const auth = new TranslationAuthService()
  const sidecar = new OverwatchOcrSidecar(window, auth)
  const gameOverlay = new GameOverlayWindowService()
  let cleanedUp = false

  function cleanup() {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    globalShortcut.unregisterAll()
    disposeOverwatchOcrAuxiliaryWindows()
    gameOverlay.dispose()
    sidecar.dispose()
  }

  registerOverwatchOcrIpc(sidecar, auth, gameOverlay)
  sidecar.setOverlay({
    ...sidecar.getOverlay(),
    alwaysOnTop: false,
    clickThrough: false,
  })

  const tray = new OverwatchTrayService(window, {
    onHidePanel: () => {
      sidecar.setOverlay({ clickThrough: false })
      hideOverwatchOcrAuxiliaryWindows()
    },
    onShowPanel: () => {
      restoreOverwatchOcrAuxiliaryWindows()
    },
    onBeforeQuit: cleanup,
  })
  tray.start()

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    const current = sidecar.getOverlay()
    sidecar.setOverlay({ clickThrough: !current.clickThrough })
  })

  if (ENVIRONMENT.IS_DEV) {
    await loadReactDevtools()
    window.webContents.once('devtools-opened', async () => {
      await waitFor(1000)
      window.webContents.reload()
    })
  }

  app.on('before-quit', () => {
    tray.allowAppQuit()
    cleanup()
    tray.dispose()
  })
})
