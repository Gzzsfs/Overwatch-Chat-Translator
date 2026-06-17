import { BrowserWindow } from 'electron'
import { join } from 'node:path'

import type { WindowProps } from 'shared/types'
import { ENVIRONMENT } from 'shared/constants'

import { settings } from 'lib/electron-router-dom'

function createRouteUrl(id: string) {
  return `http://localhost:${settings.port}/#/${id}`
}

export function createWindow({ id, ...settings }: WindowProps) {
  const window = new BrowserWindow(settings)
  const htmlFile = join(__dirname, '../renderer/index.html')

  if (ENVIRONMENT.IS_DEV) {
    window.loadURL(createRouteUrl(id))
  } else {
    window.loadFile(htmlFile, {
      hash: `/${id}`,
    })
  }

  window.on('closed', window.destroy)

  return window
}
