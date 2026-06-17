import { app, safeStorage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import type {
  DirectDeepSeekSettingsPayload,
  TranslationAuthState,
  TranslationDevice,
  TranslationLoginPayload,
  TranslationMode,
  TranslationQuota,
  TranslationSettingsState,
  TranslationUser,
} from 'shared/overwatch-ocr'

interface StoredDirectDeepSeek {
  baseUrl: string
  model: string
  prompt: string
  encryptedApiKey: string | null
}

interface StoredAuth {
  proxyBaseUrl: string
  deviceId: string
  encryptedDeviceToken: string | null
  translationMode: TranslationMode
  directDeepSeek: StoredDirectDeepSeek
  user: TranslationUser | null
  device: TranslationDevice | null
  quota: TranslationQuota | null
}

interface ProxyAuthResponse {
  user: TranslationUser
  device: TranslationDevice
  deviceToken: string
  quota?: TranslationQuota | null
}

interface ProxyMeResponse {
  user: TranslationUser
  device: TranslationDevice
  quota: TranslationQuota
}

const DEFAULT_PROXY_BASE_URL =
  process.env.TRANSLATION_PROXY_BASE_URL ?? 'http://127.0.0.1:8080'
const DEFAULT_DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_SYSTEM_PROMPT =
  '你是一个精通各国语言的翻译助手，请根据我提示的内容并且结合语境进行翻译成中文，我当前在游玩一款名为守望先锋的游戏'
const DEFAULT_TRANSLATION_MODE: TranslationMode =
  process.env.OVERWATCH_TRANSLATION_DEFAULT_MODE === 'direct'
    ? 'direct'
    : 'proxy'

function normalizeProxyBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('代理地址必须是 http 或 https。')
  }

  return parsed.toString().replace(/\/+$/, '')
}

function normalizeDeepSeekBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('DeepSeek 地址必须是 http 或 https。')
  }

  return parsed.toString().replace(/\/+$/, '')
}

function normalizeDeepSeekModel(value: string) {
  const model = value.trim()
  if (!model) {
    throw new Error('DeepSeek 模型不能为空。')
  }
  return model
}

function normalizeSystemPrompt(value: string) {
  const prompt = value.trim()
  if (!prompt) {
    throw new Error('翻译提示词不能为空。')
  }
  return prompt
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class TranslationAuthService {
  private readonly path = join(app.getPath('userData'), 'translation-auth.json')
  private stored: StoredAuth
  private lastMessage: string | null = null
  private directMessage: string | null = null

  constructor() {
    this.stored = this.load()
  }

  getState(): TranslationAuthState {
    return {
      proxyBaseUrl: this.stored.proxyBaseUrl,
      deviceId: this.stored.deviceId,
      loggedIn: Boolean(this.getDeviceToken()),
      user: this.stored.user,
      device: this.stored.device,
      quota: this.stored.quota,
      message: this.lastMessage,
    }
  }

  getTranslationState(): TranslationSettingsState {
    return {
      mode: this.stored.translationMode,
      direct: {
        apiKeyConfigured: Boolean(this.getDirectDeepSeekApiKey()),
        baseUrl: this.stored.directDeepSeek.baseUrl,
        model: this.stored.directDeepSeek.model,
        prompt: this.stored.directDeepSeek.prompt,
        message: this.directMessage,
      },
    }
  }

  setTranslationMode(mode: TranslationMode): TranslationSettingsState {
    this.stored.translationMode = mode
    this.directMessage =
      mode === 'direct' ? '已切换到直连 DeepSeek。' : '已切换到账号代理。'
    this.save()
    return this.getTranslationState()
  }

  async refresh(): Promise<TranslationAuthState> {
    const token = this.getDeviceToken()
    if (!token) {
      return this.getState()
    }

    try {
      const response = await this.requestProxy<ProxyMeResponse>('/v1/auth/me', {
        token,
        method: 'GET',
      })
      this.stored.user = response.user
      this.stored.device = response.device
      this.stored.quota = response.quota
      this.lastMessage = null
      this.save()
    } catch (error) {
      this.lastMessage = toErrorMessage(error)
    }

    return this.getState()
  }

  async login(payload: TranslationLoginPayload): Promise<TranslationAuthState> {
    this.stored.proxyBaseUrl = normalizeProxyBaseUrl(payload.proxyBaseUrl)
    const response = await this.requestProxy<ProxyAuthResponse>(
      '/v1/auth/login',
      {
        method: 'POST',
        body: {
          email: payload.email,
          password: payload.password,
          deviceId: this.stored.deviceId,
          deviceName: hostname(),
        },
      }
    )

    this.stored.encryptedDeviceToken = this.encryptToken(response.deviceToken)
    this.stored.user = response.user
    this.stored.device = response.device
    this.stored.quota = response.quota ?? null
    this.lastMessage = '已登录翻译代理。'
    this.save()
    return this.getState()
  }

  async logout(): Promise<TranslationAuthState> {
    const token = this.getDeviceToken()

    if (token) {
      try {
        await this.requestProxy('/v1/auth/logout', {
          token,
          method: 'POST',
        })
      } catch (error) {
        this.lastMessage = toErrorMessage(error)
      }
    }

    this.stored.encryptedDeviceToken = null
    this.stored.user = null
    this.stored.device = null
    this.stored.quota = null
    this.lastMessage = this.lastMessage ?? '已退出登录。'
    this.save()
    return this.getState()
  }

  setProxyBaseUrl(proxyBaseUrl: string): TranslationAuthState {
    this.stored.proxyBaseUrl = normalizeProxyBaseUrl(proxyBaseUrl)
    this.lastMessage = '代理地址已保存。'
    this.save()
    return this.getState()
  }

  setDirectDeepSeekSettings(
    payload: DirectDeepSeekSettingsPayload
  ): TranslationSettingsState {
    this.stored.directDeepSeek.baseUrl = normalizeDeepSeekBaseUrl(
      payload.baseUrl
    )
    this.stored.directDeepSeek.model = normalizeDeepSeekModel(payload.model)
    this.stored.directDeepSeek.prompt = normalizeSystemPrompt(payload.prompt)

    const apiKey = payload.apiKey?.trim()
    if (payload.clearApiKey) {
      this.stored.directDeepSeek.encryptedApiKey = null
    } else if (apiKey) {
      this.stored.directDeepSeek.encryptedApiKey = this.encryptToken(apiKey)
    } else if (!this.stored.directDeepSeek.encryptedApiKey) {
      throw new Error('请填写 DeepSeek API Key。')
    }

    this.stored.translationMode = 'direct'
    this.directMessage = 'DeepSeek API 配置已保存。'
    this.save()
    return this.getTranslationState()
  }

  getSidecarEnv(): NodeJS.ProcessEnv {
    const token = this.getDeviceToken()
    const directApiKey = this.getDirectDeepSeekApiKey()
    const mode = this.stored.translationMode

    return {
      OCR_TRANSLATION_MODE: mode,
      OCR_TRANSLATION_PROXY_URL: this.stored.proxyBaseUrl,
      OCR_TRANSLATION_DEVICE_TOKEN: mode === 'proxy' ? (token ?? '') : '',
      OCR_TRANSLATION_TARGET_LANG: 'zh-CN',
      OCR_TRANSLATION_DEVICE_TOKEN_SHA256:
        mode === 'proxy' && token ? hashToken(token) : '',
      DEEPSEEK_API_KEY: mode === 'direct' ? (directApiKey ?? '') : '',
      DEEPSEEK_BASE_URL:
        mode === 'direct' ? this.stored.directDeepSeek.baseUrl : '',
      DEEPSEEK_MODEL: mode === 'direct' ? this.stored.directDeepSeek.model : '',
      DEEPSEEK_SYSTEM_PROMPT:
        mode === 'direct' ? this.stored.directDeepSeek.prompt : '',
    }
  }

  private load(): StoredAuth {
    const fallback: StoredAuth = {
      proxyBaseUrl: normalizeProxyBaseUrl(DEFAULT_PROXY_BASE_URL),
      deviceId: randomUUID(),
      encryptedDeviceToken: null,
      translationMode: DEFAULT_TRANSLATION_MODE,
      directDeepSeek: {
        baseUrl: normalizeDeepSeekBaseUrl(DEFAULT_DEEPSEEK_BASE_URL),
        model: DEFAULT_DEEPSEEK_MODEL,
        prompt: DEFAULT_DEEPSEEK_SYSTEM_PROMPT,
        encryptedApiKey: null,
      },
      user: null,
      device: null,
      quota: null,
    }

    if (!existsSync(this.path)) {
      return fallback
    }

    try {
      const parsed = JSON.parse(
        readFileSync(this.path, 'utf8')
      ) as Partial<StoredAuth>
      return {
        ...fallback,
        ...parsed,
        proxyBaseUrl: normalizeProxyBaseUrl(
          parsed.proxyBaseUrl ?? fallback.proxyBaseUrl
        ),
        deviceId: parsed.deviceId || fallback.deviceId,
        translationMode:
          parsed.translationMode === 'direct' ? 'direct' : 'proxy',
        directDeepSeek: {
          ...fallback.directDeepSeek,
          ...(parsed.directDeepSeek ?? {}),
          baseUrl: normalizeDeepSeekBaseUrl(
            parsed.directDeepSeek?.baseUrl ?? fallback.directDeepSeek.baseUrl
          ),
          model: normalizeDeepSeekModel(
            parsed.directDeepSeek?.model ?? fallback.directDeepSeek.model
          ),
          prompt: normalizeSystemPrompt(
            parsed.directDeepSeek?.prompt ?? fallback.directDeepSeek.prompt
          ),
          encryptedApiKey:
            parsed.directDeepSeek?.encryptedApiKey ??
            fallback.directDeepSeek.encryptedApiKey,
        },
      }
    } catch {
      return fallback
    }
  }

  private save() {
    writeFileSync(this.path, JSON.stringify(this.stored, null, 2), 'utf8')
  }

  private encryptToken(token: string) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持安全保存设备令牌。')
    }

    return safeStorage.encryptString(token).toString('base64')
  }

  private getDeviceToken() {
    if (!this.stored.encryptedDeviceToken) {
      return null
    }

    try {
      return safeStorage.decryptString(
        Buffer.from(this.stored.encryptedDeviceToken, 'base64')
      )
    } catch {
      return null
    }
  }

  private getDirectDeepSeekApiKey() {
    if (!this.stored.directDeepSeek.encryptedApiKey) {
      return null
    }

    try {
      return safeStorage.decryptString(
        Buffer.from(this.stored.directDeepSeek.encryptedApiKey, 'base64')
      )
    } catch {
      return null
    }
  }

  private async requestProxy<T = unknown>(
    path: string,
    options: {
      method: 'GET' | 'POST'
      body?: unknown
      token?: string
    }
  ): Promise<T> {
    const response = await fetch(`${this.stored.proxyBaseUrl}${path}`, {
      method: options.method,
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null

    if (!response.ok) {
      throw new Error(
        payload?.message ?? payload?.error ?? `代理请求失败：${response.status}`
      )
    }

    return payload as T
  }
}
