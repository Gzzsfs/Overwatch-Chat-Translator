import { join } from 'node:path'

import { createWindow } from 'lib/electron-app/factories/windows/create'
import { displayName } from '~/package.json'

export async function MainWindow() {
  const window = createWindow({
    id: 'main',
    title: displayName,
    width: 560,
    height: 720,
    minWidth: 430,
    minHeight: 520,
    show: false,
    center: true,
    frame: false,
    movable: true,
    resizable: true,
    alwaysOnTop: false,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.setAlwaysOnTop(false)

  window.webContents.on('did-finish-load', () => {
    window.show()
  })

  return window
}
