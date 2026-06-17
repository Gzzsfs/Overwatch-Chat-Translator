import { contextBridge, ipcRenderer } from 'electron'

import {
  OVERWATCH_OCR_CHANNELS,
  type DirectDeepSeekSettingsPayload,
  type GameOverlaySettings,
  type OcrRoi,
  type OverlaySettings,
  type OverwatchOcrRuntimeEvent,
  type SidecarHealth,
  type StartWatchPayload,
  type TranslationAuthState,
  type TranslationLoginPayload,
  type TranslationMode,
  type TranslationSettingsState,
  type WindowDragPoint,
} from 'shared/overwatch-ocr'

export interface OverwatchOcrBridge {
  health(): Promise<SidecarHealth>
  startWatch(payload: StartWatchPayload): Promise<unknown>
  stopWatch(): Promise<unknown>
  selectRoi(): Promise<OcrRoi | null>
  completeRoiSelection(payload: OcrRoi): Promise<boolean>
  cancelRoiSelection(): Promise<boolean>
  getOverlay(): Promise<OverlaySettings>
  setOverlay(payload: Partial<OverlaySettings>): Promise<OverlaySettings>
  authState(): Promise<TranslationAuthState>
  login(payload: TranslationLoginPayload): Promise<TranslationAuthState>
  logout(): Promise<TranslationAuthState>
  setProxyBaseUrl(payload: string): Promise<TranslationAuthState>
  translationState(): Promise<TranslationSettingsState>
  setTranslationMode(
    payload: TranslationMode
  ): Promise<TranslationSettingsState>
  setDirectDeepSeek(
    payload: DirectDeepSeekSettingsPayload
  ): Promise<TranslationSettingsState>
  showGameOverlay(): Promise<GameOverlaySettings>
  hideGameOverlay(): Promise<GameOverlaySettings>
  getGameOverlay(): Promise<GameOverlaySettings>
  setGameOverlay(
    payload: Partial<GameOverlaySettings>
  ): Promise<GameOverlaySettings>
  startWindowDrag(payload: WindowDragPoint): Promise<boolean>
  moveWindowDrag(payload: WindowDragPoint): Promise<boolean>
  endWindowDrag(): Promise<boolean>
  startWindowResize(payload: WindowDragPoint): Promise<boolean>
  moveWindowResize(payload: WindowDragPoint): Promise<boolean>
  endWindowResize(): Promise<boolean>
  subscribeRuntimeEvents(
    listener: (event: OverwatchOcrRuntimeEvent) => void
  ): () => void
}

declare global {
  interface Window {
    Ocr: OverwatchOcrBridge
  }
}

const ocrBridge: OverwatchOcrBridge = {
  health: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.health),
  startWatch: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.startWatch, payload),
  stopWatch: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.stopWatch),
  selectRoi: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.selectRoi),
  completeRoiSelection: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.completeRoiSelection, payload),
  cancelRoiSelection: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.cancelRoiSelection),
  getOverlay: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.getOverlay),
  setOverlay: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.setOverlay, payload),
  authState: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.authState),
  login: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.authLogin, payload),
  logout: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.authLogout),
  setProxyBaseUrl: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.authSetProxy, payload),
  translationState: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.translationState),
  setTranslationMode: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.translationSetMode, payload),
  setDirectDeepSeek: payload =>
    ipcRenderer.invoke(
      OVERWATCH_OCR_CHANNELS.translationSetDirectDeepSeek,
      payload
    ),
  showGameOverlay: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.showGameOverlay),
  hideGameOverlay: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.hideGameOverlay),
  getGameOverlay: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.getGameOverlay),
  setGameOverlay: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.setGameOverlay, payload),
  startWindowDrag: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowDragStart, payload),
  moveWindowDrag: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowDragMove, payload),
  endWindowDrag: () => ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowDragEnd),
  startWindowResize: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowResizeStart, payload),
  moveWindowResize: payload =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowResizeMove, payload),
  endWindowResize: () =>
    ipcRenderer.invoke(OVERWATCH_OCR_CHANNELS.windowResizeEnd),
  subscribeRuntimeEvents: listener => {
    const subscription = (
      _: Electron.IpcRendererEvent,
      payload: OverwatchOcrRuntimeEvent
    ) => listener(payload)

    ipcRenderer.on(OVERWATCH_OCR_CHANNELS.runtimeEvent, subscription)

    return () => {
      ipcRenderer.off(OVERWATCH_OCR_CHANNELS.runtimeEvent, subscription)
    }
  },
}

contextBridge.exposeInMainWorld('Ocr', ocrBridge)
