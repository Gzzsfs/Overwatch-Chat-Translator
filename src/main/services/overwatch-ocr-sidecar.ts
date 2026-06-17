import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import WebSocket from 'ws'

import {
  OVERWATCH_OCR_CHANNELS,
  type OcrRoi,
  type OverlaySettings,
  type SidecarHealth,
  type StartWatchPayload,
} from 'shared/overwatch-ocr'
import type { TranslationAuthService } from './translation-auth'

type SidecarStatus = SidecarHealth['sidecar']['status']

const STARTUP_TIMEOUT_MS = 18_000
const HEALTH_POLL_MS = 400

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
        } else {
          reject(new Error('Unable to allocate OCR service port.'))
        }
      })
    })
    server.on('error', reject)
  })
}

function commandExists(command: string) {
  if (command.includes('\\') || command.includes('/')) {
    return existsSync(command)
  }

  return true
}

export class OverwatchOcrSidecar {
  private process: ChildProcessWithoutNullStreams | null = null
  private ws: WebSocket | null = null
  private clickThroughGuardWindow: BrowserWindow | null = null
  private status: SidecarStatus = 'idle'
  private message = 'OCR service is not running.'
  private baseUrl: string | null = null
  private pythonPath: string | null = null
  private serviceDir: string | null = null
  private modelsHome: string | null = null
  private overlay: OverlaySettings = {
    alwaysOnTop: false,
    clickThrough: false,
    opacity: 0.92,
    fontSize: 15,
  }

  constructor(
    private readonly window: BrowserWindow,
    private readonly auth: TranslationAuthService
  ) {
    const syncGuard = () => this.syncClickThroughGuard()
    this.window.on('move', syncGuard)
    this.window.on('resize', syncGuard)
  }

  getOverlay() {
    return this.overlay
  }

  setOverlay(settings: Partial<OverlaySettings>) {
    this.overlay = {
      ...this.overlay,
      ...settings,
      opacity: Math.max(
        0.35,
        Math.min(1, settings.opacity ?? this.overlay.opacity)
      ),
      fontSize: Math.max(
        12,
        Math.min(24, settings.fontSize ?? this.overlay.fontSize)
      ),
    }

    this.window.setOpacity(this.overlay.opacity)
    if (this.overlay.alwaysOnTop) {
      this.window.setAlwaysOnTop(true, 'screen-saver')
    } else {
      this.window.setAlwaysOnTop(false)
    }
    this.window.setIgnoreMouseEvents(this.overlay.clickThrough, {
      forward: true,
    })
    this.syncClickThroughGuard()
    if (!this.overlay.clickThrough) {
      this.window.show()
      this.window.focus()
    }
    this.emit({
      type: 'overlay.changed',
      payload: this.overlay,
    })

    return this.overlay
  }

  async health(): Promise<SidecarHealth> {
    const sidecar = this.sidecarSnapshot()

    if (!this.baseUrl || this.status !== 'running') {
      return { ok: false, sidecar }
    }

    try {
      const service = await this.requestService('/health')
      return {
        ok: true,
        sidecar: this.sidecarSnapshot(),
        service,
      }
    } catch (error) {
      this.status = 'error'
      this.message = toErrorMessage(error)
      return {
        ok: false,
        sidecar: this.sidecarSnapshot(),
      }
    }
  }

  async startWatch(payload: StartWatchPayload) {
    await this.ensureStarted()
    return this.requestService('/watch/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async stopWatch() {
    if (!this.baseUrl || this.status !== 'running') {
      return { running: false }
    }

    return this.requestService('/watch/stop', { method: 'POST' })
  }

  dispose() {
    this.ws?.close()
    this.ws = null
    this.destroyClickThroughGuard()

    if (this.process && !this.process.killed) {
      this.process.kill()
    }
    this.process = null
    this.status = 'idle'
    this.baseUrl = null
    this.emitSidecarStatus()
  }

  private async ensureStarted() {
    if (this.status === 'running' && this.process && this.baseUrl) {
      return
    }

    if (this.status === 'starting') {
      await this.waitUntilRunning()
      return
    }

    this.ws?.close()
    this.ws = null
    if (this.process && !this.process.killed) {
      this.process.kill()
    }
    this.process = null

    this.status = 'starting'
    this.message = 'Starting OCR service.'
    this.emitSidecarStatus()

    this.serviceDir = this.resolveServiceDir()
    this.pythonPath = this.resolvePythonPath()
    this.modelsHome = this.resolveModelsHome()

    if (!this.serviceDir) {
      this.status = 'error'
      this.message = 'ocr-service directory was not found.'
      this.emitSidecarStatus()
      throw new Error(this.message)
    }

    if (!this.pythonPath || !commandExists(this.pythonPath)) {
      this.status = 'error'
      this.message =
        'Embedded PaddleOCR runtime was not found. Run pnpm prepare:ocr-runtime before packaging, or set OVERWATCH_OCR_PYTHON.'
      this.emitSidecarStatus()
      throw new Error(this.message)
    }

    const port = await findFreePort()
    this.baseUrl = `http://127.0.0.1:${port}`

    this.process = spawn(
      this.pythonPath,
      [
        '-m',
        'uvicorn',
        'app:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: this.serviceDir,
        env: {
          ...process.env,
          ...this.auth.getSidecarEnv(),
          HOME: this.modelsHome ?? undefined,
          USERPROFILE: this.modelsHome ?? undefined,
          PADDLE_PDX_MODEL_SOURCE: process.env.PADDLE_PDX_MODEL_SOURCE ?? 'bos',
          PYTHONUNBUFFERED: '1',
        },
        windowsHide: true,
      }
    )

    this.process.stdout.on('data', chunk => {
      this.message = String(chunk).trim().slice(-500) || this.message
    })
    this.process.stderr.on('data', chunk => {
      this.message = String(chunk).trim().slice(-500) || this.message
    })
    this.process.once('exit', code => {
      if (this.status !== 'idle') {
        this.status = code === 0 ? 'idle' : 'error'
        this.message = `OCR service exited with code ${code ?? 'unknown'}.`
        this.baseUrl = null
        this.emitSidecarStatus()
      }
    })

    await this.waitUntilRunning()
    this.connectEvents()
  }

  private async waitUntilRunning() {
    const startedAt = Date.now()

    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
      if (!this.baseUrl) {
        break
      }

      try {
        await this.requestService('/health')
        this.status = 'running'
        this.message = 'OCR service is running.'
        this.emitSidecarStatus()
        return
      } catch {
        await wait(HEALTH_POLL_MS)
      }
    }

    this.status = 'error'
    this.message = this.message || 'OCR service did not become ready in time.'
    if (this.process && !this.process.killed) {
      this.process.kill()
    }
    this.process = null
    this.baseUrl = null
    this.emitSidecarStatus()
    throw new Error(this.message)
  }

  private async requestService(path: string, init?: RequestInit) {
    if (!this.baseUrl) {
      throw new Error('OCR service has not been started.')
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      throw new Error(`OCR service ${path} failed: ${response.status}`)
    }

    return response.json()
  }

  private connectEvents() {
    if (!this.baseUrl || this.ws) {
      return
    }

    const wsUrl = this.baseUrl.replace(/^http/, 'ws')
    this.ws = new WebSocket(`${wsUrl}/events`)
    this.ws.on('message', data => {
      try {
        this.emit(JSON.parse(String(data)))
      } catch {
        // Ignore malformed sidecar events.
      }
    })
    this.ws.on('close', () => {
      this.ws = null
    })
  }

  private syncClickThroughGuard() {
    if (!this.overlay.clickThrough || this.window.isDestroyed()) {
      this.destroyClickThroughGuard()
      return
    }

    const bounds = this.window.getBounds()
    const guardBounds = {
      x: bounds.x + bounds.width - 56,
      y: bounds.y + 12,
      width: 44,
      height: 44,
    }

    if (
      this.clickThroughGuardWindow &&
      !this.clickThroughGuardWindow.isDestroyed()
    ) {
      this.clickThroughGuardWindow.setBounds(guardBounds)
      this.clickThroughGuardWindow.showInactive()
      return
    }

    this.clickThroughGuardWindow = new BrowserWindow({
      ...guardBounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
      },
    })
    this.clickThroughGuardWindow.setAlwaysOnTop(true, 'screen-saver')
    this.clickThroughGuardWindow.on('closed', () => {
      this.clickThroughGuardWindow = null
    })
    this.clickThroughGuardWindow.loadURL(
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

              button {
                width: 40px;
                height: 40px;
                margin: 2px;
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 14px;
                background: rgba(9, 9, 11, 0.86);
                color: rgba(224, 242, 254, 0.96);
                box-shadow: 0 12px 34px rgba(0, 0, 0, 0.44), 0 0 18px rgba(34, 211, 238, 0.32);
                cursor: pointer;
                display: grid;
                place-items: center;
              }

              button:hover {
                background: rgba(8, 47, 73, 0.9);
              }

              svg {
                width: 18px;
                height: 18px;
              }
            </style>
          </head>
          <body>
            <button id="restore" title="关闭点击穿透">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10.733 5.076A10.744 10.744 0 0 1 12 5c5 0 8.5 4 10 7a13.52 13.52 0 0 1-1.67 2.68" />
                <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
                <path d="M17.479 17.499A10.75 10.75 0 0 1 12 19c-5 0-8.5-4-10-7a13.04 13.04 0 0 1 5.35-5.82" />
                <path d="m2 2 20 20" />
              </svg>
            </button>
            <script>
              document.getElementById('restore').addEventListener('click', () => {
                window.Ocr.setOverlay({ clickThrough: false });
              });
            </script>
          </body>
        </html>
      `)}`
    )
  }

  private destroyClickThroughGuard() {
    if (
      this.clickThroughGuardWindow &&
      !this.clickThroughGuardWindow.isDestroyed()
    ) {
      this.clickThroughGuardWindow.close()
    }
    this.clickThroughGuardWindow = null
  }

  private resolveServiceDir() {
    const candidates = [
      join(process.cwd(), 'ocr-service'),
      join(app.getAppPath(), 'ocr-service'),
      join(process.resourcesPath, 'ocr-service'),
    ]

    return (
      candidates.find(candidate => existsSync(join(candidate, 'app.py'))) ??
      null
    )
  }

  private resolvePythonPath() {
    const envPath = process.env.OVERWATCH_OCR_PYTHON ?? process.env.OCR_PYTHON
    const bundledCandidates = [
      envPath,
      join(process.cwd(), 'ocr-runtime', 'Scripts', 'python.exe'),
      join(process.cwd(), 'ocr-runtime', 'python.exe'),
      this.serviceDir
        ? join(this.serviceDir, '.venv', 'Scripts', 'python.exe')
        : null,
      join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
      join(app.getAppPath(), 'ocr-runtime', 'Scripts', 'python.exe'),
      join(app.getAppPath(), 'ocr-runtime', 'python.exe'),
      join(process.resourcesPath, 'ocr-runtime', 'Scripts', 'python.exe'),
      join(process.resourcesPath, 'ocr-runtime', 'python.exe'),
      'python',
    ].filter(Boolean) as string[]

    return (
      bundledCandidates.find(candidate => {
        if (basename(candidate).toLowerCase() === 'python') {
          return true
        }

        return existsSync(candidate)
      }) ?? null
    )
  }

  private resolveModelsHome() {
    const envPath =
      process.env.OVERWATCH_OCR_MODELS_HOME ??
      process.env.PADDLE_OCR_MODELS_HOME

    if (envPath) {
      mkdirSync(envPath, { recursive: true })
      return envPath
    }

    const userModelsHome = join(app.getPath('userData'), 'ocr-models')
    const bundledModelsHome = [
      join(process.cwd(), 'ocr-models'),
      join(app.getAppPath(), 'ocr-models'),
      join(process.resourcesPath, 'ocr-models'),
    ].find(candidate =>
      existsSync(join(candidate, '.paddlex', 'official_models'))
    )

    if (
      bundledModelsHome &&
      !existsSync(join(userModelsHome, '.paddlex', 'official_models'))
    ) {
      mkdirSync(userModelsHome, { recursive: true })
      cpSync(bundledModelsHome, userModelsHome, {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }

    mkdirSync(userModelsHome, { recursive: true })
    return userModelsHome
  }

  private sidecarSnapshot(): SidecarHealth['sidecar'] {
    return {
      status: this.status,
      baseUrl: this.baseUrl,
      pythonPath: this.pythonPath,
      serviceDir: this.serviceDir,
      modelsHome: this.modelsHome,
      message: this.message,
    }
  }

  private emitSidecarStatus() {
    this.emit({
      type: 'sidecar.status',
      payload: this.sidecarSnapshot(),
    })
  }

  private emit(payload: unknown) {
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (!candidate.isDestroyed()) {
        candidate.webContents.send(OVERWATCH_OCR_CHANNELS.runtimeEvent, payload)
      }
    }
  }
}

export function normalizeRoi(roi: OcrRoi): OcrRoi {
  const left = Math.round(Math.min(roi.left, roi.left + roi.width))
  const top = Math.round(Math.min(roi.top, roi.top + roi.height))
  return {
    left,
    top,
    width: Math.max(1, Math.round(Math.abs(roi.width))),
    height: Math.max(1, Math.round(Math.abs(roi.height))),
  }
}
