import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'

import { requireAuth, type AuthContext } from './auth.js'
import { config } from './config.js'
import { query } from './db.js'
import { appError, AppError } from './errors.js'
import { getRedis } from './redis.js'

interface ChatMessage {
  speaker?: string
  text?: string
  channel?: string
}

interface TranslateBody {
  targetLang?: string
  context?: ChatMessage[]
  message?: ChatMessage
}

function countCharacters(body: TranslateBody) {
  const messageChars = body.message?.text?.length ?? 0
  const contextChars =
    body.context?.reduce((total, item) => total + (item.text?.length ?? 0), 0) ??
    0
  return messageChars + contextChars
}

function buildUserPrompt(body: TranslateBody) {
  const context = (body.context ?? [])
    .slice(-10)
    .filter(item => item.text)
    .map(item => `${item.speaker ?? 'unknown'}: ${item.text}`)
  const message = body.message

  return [
    '最近聊天上下文:',
    ...context,
    '',
    '当前要翻译:',
    `${message?.speaker ?? 'unknown'}: ${message?.text ?? ''}`,
  ].join('\n')
}

async function checkRateLimit(auth: AuthContext, charCount: number) {
  const redis = await getRedis()
  const minuteKey = `rl:req:${auth.device.id}:${Math.floor(Date.now() / 60_000)}`
  const day = new Date().toISOString().slice(0, 10)
  const charKey = `rl:char:${auth.user.id}:${day}`
  const concurrencyKey = `rl:con:${auth.device.id}`

  const requests = await redis.incr(minuteKey)
  if (requests === 1) {
    await redis.expire(minuteKey, 90)
  }
  if (requests > config.requestsPerMinute) {
    throw appError(429, '请求过于频繁，请稍后再试。', 'RATE_LIMIT_REQUESTS')
  }

  const characters = await redis.incrby(charKey, charCount)
  if (characters === charCount) {
    await redis.expire(charKey, 172_800)
  }
  if (characters > config.dailyCharacterLimit) {
    throw appError(429, '今日翻译字符数已用完。', 'RATE_LIMIT_CHARACTERS')
  }

  const concurrent = await redis.incr(concurrencyKey)
  await redis.expire(concurrencyKey, 30)
  if (concurrent > config.concurrentRequests) {
    await redis.decr(concurrencyKey)
    throw appError(429, '并发请求过多，请稍后再试。', 'RATE_LIMIT_CONCURRENCY')
  }

  return async () => {
    await redis.decr(concurrencyKey).catch(() => undefined)
  }
}

async function recordUsage(userId: string, charCount: number, ok: boolean) {
  await query(
    `insert into translation_usage_daily (
       user_id, day, request_count, character_count, failure_count
     )
     values ($1, current_date, 1, $2, $3)
     on conflict (user_id, day)
     do update set
       request_count = translation_usage_daily.request_count + 1,
       character_count = translation_usage_daily.character_count + $2,
       failure_count = translation_usage_daily.failure_count + $3,
       updated_at = now()`,
    [userId, charCount, ok ? 0 : 1]
  )
}

async function recordAudit(input: {
  requestId: string
  auth: AuthContext | null
  status: 'ok' | 'error'
  errorCode?: string
  latencyMs?: number
  charCount: number
}) {
  await query(
    `insert into audit_events (
       id, user_id, device_id, event_type, status, error_code, latency_ms, character_count
     )
     values ($1, $2, $3, 'translate', $4, $5, $6, $7)`,
    [
      input.requestId,
      input.auth?.user.id ?? null,
      input.auth?.device.id ?? null,
      input.status,
      input.errorCode ?? null,
      input.latencyMs ?? null,
      input.charCount,
    ]
  )
}

async function callDeepSeek(body: TranslateBody) {
  if (!config.deepseekApiKey) {
    throw appError(503, '翻译服务未配置。', 'DEEPSEEK_NOT_CONFIGURED')
  }

  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(config.deepseekTimeoutMs),
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        {
          role: 'system',
          content:
            '你是守望先锋游戏聊天即时翻译器。把外国玩家的聊天翻译成简短自然的中文。保留英雄名、玩家名、技能名、地图名、常见缩写和语气。不要解释，不要扩写，不要输出引号，只输出译文。',
        },
        {
          role: 'user',
          content: buildUserPrompt(body),
        },
      ],
      temperature: 0.2,
      stream: false,
    }),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw appError(
      502,
      payload?.error?.message ?? payload?.message ?? 'DeepSeek 请求失败。',
      `DEEPSEEK_${response.status}`
    )
  }

  const translatedText = payload?.choices?.[0]?.message?.content?.trim()
  if (!translatedText) {
    throw appError(502, 'DeepSeek 返回空翻译。', 'DEEPSEEK_EMPTY')
  }

  return translatedText as string
}

export async function registerTranslateRoutes(app: FastifyInstance) {
  app.post('/v1/translate/chat', async request => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    let auth: AuthContext | null = null
    let releaseConcurrency: (() => Promise<void>) | null = null
    const body = request.body as TranslateBody
    const charCount = countCharacters(body)

    try {
      auth = await requireAuth(request)
      if (!body.message?.text) {
        throw appError(400, '缺少要翻译的消息文本。', 'INVALID_INPUT')
      }

      releaseConcurrency = await checkRateLimit(auth, charCount)
      const translatedText = await callDeepSeek(body)
      const latencyMs = Date.now() - startedAt
      await recordUsage(auth.user.id, charCount, true)
      await recordAudit({
        requestId,
        auth,
        status: 'ok',
        latencyMs,
        charCount,
      })

      return {
        translatedText,
        model: config.deepseekModel,
        requestId,
        usage: {
          characters: charCount,
          latencyMs,
        },
      }
    } catch (error) {
      const appErrorValue =
        error instanceof AppError
          ? error
          : appError(500, error instanceof Error ? error.message : String(error))

      if (auth) {
        await recordUsage(auth.user.id, charCount, false).catch(() => undefined)
        await recordAudit({
          requestId,
          auth,
          status: 'error',
          errorCode: appErrorValue.code,
          latencyMs: Date.now() - startedAt,
          charCount,
        }).catch(() => undefined)
      }

      throw appErrorValue
    } finally {
      await releaseConcurrency?.()
    }
  })
}
