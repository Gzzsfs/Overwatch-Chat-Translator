import { describe, expect, it } from 'vitest'

import { OVERWATCH_OCR_CHANNELS, type StartWatchPayload } from './overwatch-ocr'

describe('overwatch OCR public contract', () => {
  it('exposes auth channels for proxy login', () => {
    expect(OVERWATCH_OCR_CHANNELS.authLogin).toBe('overwatch-ocr:auth-login')
    expect(OVERWATCH_OCR_CHANNELS.authLogout).toBe('overwatch-ocr:auth-logout')
  })

  it('exposes direct DeepSeek configuration channels', () => {
    expect(OVERWATCH_OCR_CHANNELS.translationState).toBe(
      'overwatch-ocr:translation-state'
    )
    expect(OVERWATCH_OCR_CHANNELS.translationSetDirectDeepSeek).toBe(
      'overwatch-ocr:translation-set-direct-deepseek'
    )
  })

  it('keeps public OCR capture on CPU', () => {
    const payload = {
      roi: { left: 0, top: 0, width: 100, height: 100 },
      fps: 1,
      modelTier: 'small',
      language: 'auto',
      device: 'cpu',
      cpuThreads: 6,
      translate: true,
    } satisfies StartWatchPayload

    expect(payload.device).toBe('cpu')
  })
})
