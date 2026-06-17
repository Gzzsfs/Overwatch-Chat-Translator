import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import Fastify from 'fastify'

import { registerAuthRoutes } from './auth.js'
import { config } from './config.js'
import { pool } from './db.js'
import { AppError } from './errors.js'
import { registerTranslateRoutes } from './translate.js'

const app = Fastify({
  logger: true,
})

await app.register(cors, {
  origin: true,
})
await app.register(helmet)

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
    })
    return
  }

  app.log.error(error)
  reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: '服务内部错误。',
  })
})

app.get('/health', async () => ({
  ok: true,
  deepseek: {
    configured: Boolean(config.deepseekApiKey),
    model: config.deepseekModel,
    baseUrl: config.deepseekBaseUrl,
  },
  registration: {
    publicEnabled: config.allowPublicRegistration,
  },
}))

await registerAuthRoutes(app)
await registerTranslateRoutes(app)

const close = async () => {
  await app.close()
  await pool.end()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

await app.listen({
  host: '0.0.0.0',
  port: config.port,
})
