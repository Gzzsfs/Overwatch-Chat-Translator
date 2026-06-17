import 'dotenv/config'

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: intEnv('PORT', 8080),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://overwatch:overwatch_dev_password@127.0.0.1:5432/overwatch_translator',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  allowPublicRegistration:
    process.env.ALLOW_PUBLIC_REGISTRATION?.toLowerCase() === 'true',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: (
    process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  ).replace(/\/+$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  deepseekTimeoutMs: intEnv('DEEPSEEK_TIMEOUT_MS', 12_000),
  requestsPerMinute: intEnv('RATE_LIMIT_REQUESTS_PER_MINUTE', 60),
  concurrentRequests: intEnv('RATE_LIMIT_CONCURRENT_REQUESTS', 4),
  dailyCharacterLimit: intEnv('DAILY_CHARACTER_LIMIT', 200_000),
}
