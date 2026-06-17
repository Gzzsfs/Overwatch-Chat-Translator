import { Redis } from 'ioredis'

import { config } from './config.js'

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
})

let connected = false

export async function getRedis() {
  if (!connected) {
    await redis.connect()
    connected = true
  }

  return redis
}
