export type OverwatchOcrChannelName =
  | 'health'
  | 'startWatch'
  | 'stopWatch'
  | 'selectRoi'
  | 'completeRoiSelection'
  | 'cancelRoiSelection'
  | 'setOverlay'
  | 'getOverlay'
  | 'authState'
  | 'authLogin'
  | 'authLogout'
  | 'authSetProxy'
  | 'translationState'
  | 'translationSetMode'
  | 'translationSetDirectDeepSeek'
  | 'showGameOverlay'
  | 'hideGameOverlay'
  | 'getGameOverlay'
  | 'setGameOverlay'
  | 'windowDragStart'
  | 'windowDragMove'
  | 'windowDragEnd'
  | 'windowResizeStart'
  | 'windowResizeMove'
  | 'windowResizeEnd'
  | 'runtimeEvent'

export const OVERWATCH_OCR_CHANNELS = {
  health: 'overwatch-ocr:health',
  startWatch: 'overwatch-ocr:start-watch',
  stopWatch: 'overwatch-ocr:stop-watch',
  selectRoi: 'overwatch-ocr:select-roi',
  completeRoiSelection: 'overwatch-ocr:complete-roi-selection',
  cancelRoiSelection: 'overwatch-ocr:cancel-roi-selection',
  setOverlay: 'overwatch-ocr:set-overlay',
  getOverlay: 'overwatch-ocr:get-overlay',
  authState: 'overwatch-ocr:auth-state',
  authLogin: 'overwatch-ocr:auth-login',
  authLogout: 'overwatch-ocr:auth-logout',
  authSetProxy: 'overwatch-ocr:auth-set-proxy',
  translationState: 'overwatch-ocr:translation-state',
  translationSetMode: 'overwatch-ocr:translation-set-mode',
  translationSetDirectDeepSeek: 'overwatch-ocr:translation-set-direct-deepseek',
  showGameOverlay: 'overwatch-ocr:show-game-overlay',
  hideGameOverlay: 'overwatch-ocr:hide-game-overlay',
  getGameOverlay: 'overwatch-ocr:get-game-overlay',
  setGameOverlay: 'overwatch-ocr:set-game-overlay',
  windowDragStart: 'overwatch-ocr:window-drag-start',
  windowDragMove: 'overwatch-ocr:window-drag-move',
  windowDragEnd: 'overwatch-ocr:window-drag-end',
  windowResizeStart: 'overwatch-ocr:window-resize-start',
  windowResizeMove: 'overwatch-ocr:window-resize-move',
  windowResizeEnd: 'overwatch-ocr:window-resize-end',
  runtimeEvent: 'overwatch-ocr:runtime-event',
} as const satisfies Record<OverwatchOcrChannelName, string>

export type OcrMessageKind = 'player' | 'system' | 'unknown'

export interface OcrRoi {
  left: number
  top: number
  width: number
  height: number
}

export interface StartWatchPayload {
  roi: OcrRoi
  fps: number
  modelTier: 'tiny' | 'small' | 'medium'
  language: 'auto' | 'ch' | 'en' | 'korean' | 'japan'
  device: 'cpu'
  cpuThreads: number
  translate: boolean
}

export interface OcrBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrTranslation {
  ok: boolean
  translatedText: string | null
  error: string | null
  model: string
}

export interface ClassifiedOcrMessage {
  kind: OcrMessageKind
  speaker: string | null
  text: string
  confidence: number
  rawLine: string
  bounds: OcrBounds | null
  translation?: OcrTranslation | null
}

export interface OcrResultPayload {
  at: number
  ocrMs: number
  messages: ClassifiedOcrMessage[]
}

export interface OcrStatusPayload {
  running: boolean
  ocrLoaded: boolean
  translatorConfigured: boolean
  proxyConfigured: boolean
  lastError: string | null
}

export interface TranslationUser {
  id: string
  email: string
  displayName: string | null
  status: 'active' | 'disabled'
}

export interface TranslationDevice {
  id: string
  deviceId: string
  deviceName: string
  revoked: boolean
}

export interface TranslationQuota {
  requestsToday: number
  charactersToday: number
  dailyCharacterLimit: number
}

export interface TranslationAuthState {
  proxyBaseUrl: string
  deviceId: string
  loggedIn: boolean
  user: TranslationUser | null
  device: TranslationDevice | null
  quota: TranslationQuota | null
  message: string | null
}

export interface TranslationLoginPayload {
  proxyBaseUrl: string
  email: string
  password: string
}

export type TranslationMode = 'proxy' | 'direct'

export interface DirectDeepSeekState {
  apiKeyConfigured: boolean
  baseUrl: string
  model: string
  prompt: string
  message: string | null
}

export interface TranslationSettingsState {
  mode: TranslationMode
  direct: DirectDeepSeekState
}

export interface DirectDeepSeekSettingsPayload {
  apiKey?: string
  baseUrl: string
  model: string
  prompt: string
  clearApiKey?: boolean
}

export interface WindowDragPoint {
  screenX: number
  screenY: number
}

export interface GameOverlaySettings {
  visible: boolean
  alwaysOnTop: boolean
  opacity: number
  fontSize: number
  maxMessages: number
}

export interface SidecarHealth {
  ok: boolean
  sidecar: {
    status: 'idle' | 'starting' | 'running' | 'error'
    baseUrl: string | null
    pythonPath: string | null
    serviceDir: string | null
    modelsHome: string | null
    message: string
  }
  service?: {
    ok: boolean
    pid: number
    dependencies: Record<string, boolean>
    watch: OcrStatusPayload
    proxy: {
      configured: boolean
      baseUrl: string
      targetLang: string
      mode?: TranslationMode
      model?: string
    }
  }
}

export interface OverlaySettings {
  alwaysOnTop: boolean
  clickThrough: boolean
  opacity: number
  fontSize: number
}

export type OverwatchOcrRuntimeEvent =
  | { type: 'ocr.status'; payload: OcrStatusPayload }
  | { type: 'ocr.result'; payload: OcrResultPayload }
  | { type: 'ocr.error'; payload: { message: string } }
  | { type: 'sidecar.status'; payload: SidecarHealth['sidecar'] }
  | { type: 'overlay.changed'; payload: OverlaySettings }
  | { type: 'gameOverlay.changed'; payload: GameOverlaySettings }
