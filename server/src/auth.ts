import type { FastifyInstance, FastifyRequest } from 'fastify'

import { config } from './config.js'
import {
  hashPassword,
  hashToken,
  newDeviceToken,
  newId,
  verifyPassword,
} from './crypto.js'
import { query } from './db.js'
import { appError } from './errors.js'

interface UserRow {
  id: string
  email: string
  display_name: string | null
  status: 'active' | 'disabled'
  password_hash: string
}

interface DeviceRow {
  id: string
  user_id: string
  device_id: string
  device_name: string
  revoked: boolean
}

interface UsageRow {
  request_count: number
  character_count: number
}

export interface AuthContext {
  user: {
    id: string
    email: string
    displayName: string | null
    status: 'active' | 'disabled'
  }
  device: {
    id: string
    deviceId: string
    deviceName: string
    revoked: boolean
  }
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
  }
}

function publicDevice(row: DeviceRow) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    revoked: row.revoked,
  }
}

async function getQuota(userId: string) {
  const { rows } = await query<UsageRow>(
    `select request_count, character_count
       from translation_usage_daily
      where user_id = $1 and day = current_date`,
    [userId]
  )
  const usage = rows[0]

  return {
    requestsToday: usage?.request_count ?? 0,
    charactersToday: usage?.character_count ?? 0,
    dailyCharacterLimit: config.dailyCharacterLimit,
  }
}

export async function requireAuth(request: FastifyRequest): Promise<AuthContext> {
  const authorization = request.headers.authorization ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  if (!token) {
    throw appError(401, '缺少设备令牌。', 'AUTH_REQUIRED')
  }

  const { rows } = await query<
    UserRow &
      DeviceRow & {
        device_pk: string
        user_status: 'active' | 'disabled'
      }
  >(
    `select
        u.id,
        u.email,
        u.display_name,
        u.status as user_status,
        u.password_hash,
        d.id as device_pk,
        d.user_id,
        d.device_id,
        d.device_name,
        (d.revoked_at is not null) as revoked
       from devices d
       join users u on u.id = d.user_id
      where d.token_hash = $1
      limit 1`,
    [hashToken(token)]
  )
  const row = rows[0]

  if (!row || row.revoked || row.user_status !== 'active') {
    throw appError(401, '设备令牌无效或已失效。', 'AUTH_INVALID')
  }

  await query('update devices set last_seen_at = now() where id = $1', [
    row.device_pk,
  ])

  return {
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.user_status,
    },
    device: {
      id: row.device_pk,
      deviceId: row.device_id,
      deviceName: row.device_name,
      revoked: row.revoked,
    },
  }
}

async function createUser(input: {
  email: string
  password: string
  displayName?: string | null
}) {
  const email = input.email.trim()
  const lowerEmail = email.toLowerCase()
  const passwordHash = await hashPassword(input.password)
  const { rows } = await query<UserRow>(
    `insert into users (id, email, lower_email, display_name, password_hash)
     values ($1, $2, $3, $4, $5)
     returning id, email, display_name, status, password_hash`,
    [newId(), email, lowerEmail, input.displayName ?? null, passwordHash]
  )

  return rows[0]
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', async request => {
    if (!config.allowPublicRegistration) {
      throw appError(403, '公开注册暂未开放。', 'REGISTRATION_CLOSED')
    }

    const body = request.body as {
      email?: string
      password?: string
      displayName?: string
    }

    if (!body.email || !body.password || body.password.length < 8) {
      throw appError(400, '邮箱和至少 8 位密码是必填项。', 'INVALID_INPUT')
    }

    const user = await createUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    })
    return { user: publicUser(user) }
  })

  app.post('/v1/auth/login', async request => {
    const body = request.body as {
      email?: string
      password?: string
      deviceId?: string
      deviceName?: string
    }

    if (!body.email || !body.password || !body.deviceId || !body.deviceName) {
      throw appError(400, '邮箱、密码、设备 ID 和设备名称是必填项。', 'INVALID_INPUT')
    }

    const { rows } = await query<UserRow>(
      `select id, email, display_name, status, password_hash
         from users
        where lower_email = $1
        limit 1`,
      [body.email.trim().toLowerCase()]
    )
    const user = rows[0]

    if (
      !user ||
      user.status !== 'active' ||
      !(await verifyPassword(body.password, user.password_hash))
    ) {
      throw appError(401, '邮箱或密码错误。', 'LOGIN_FAILED')
    }

    const deviceToken = newDeviceToken()
    const { rows: deviceRows } = await query<DeviceRow>(
      `insert into devices (
        id, user_id, device_id, device_name, token_hash, revoked_at, last_seen_at
       )
       values ($1, $2, $3, $4, $5, null, now())
       on conflict (user_id, device_id)
       do update set
         device_name = excluded.device_name,
         token_hash = excluded.token_hash,
         revoked_at = null,
         last_seen_at = now(),
         updated_at = now()
       returning id, user_id, device_id, device_name, (revoked_at is not null) as revoked`,
      [newId(), user.id, body.deviceId, body.deviceName, hashToken(deviceToken)]
    )

    return {
      user: publicUser(user),
      device: publicDevice(deviceRows[0]),
      deviceToken,
      quota: await getQuota(user.id),
    }
  })

  app.post('/v1/auth/logout', async request => {
    const auth = await requireAuth(request)
    await query('update devices set revoked_at = now() where id = $1', [
      auth.device.id,
    ])
    return { ok: true }
  })

  app.get('/v1/auth/me', async request => {
    const auth = await requireAuth(request)
    return {
      user: auth.user,
      device: auth.device,
      quota: await getQuota(auth.user.id),
    }
  })
}

export const authCli = {
  async createUser(email: string, password: string, displayName?: string) {
    return createUser({ email, password, displayName })
  },

  async resetPassword(email: string, password: string) {
    const passwordHash = await hashPassword(password)
    const { rowCount } = await query(
      `update users set password_hash = $1, updated_at = now()
        where lower_email = $2`,
      [passwordHash, email.trim().toLowerCase()]
    )
    return rowCount ?? 0
  },

  async setUserStatus(email: string, status: 'active' | 'disabled') {
    const { rowCount } = await query(
      `update users set status = $1, updated_at = now()
        where lower_email = $2`,
      [status, email.trim().toLowerCase()]
    )
    return rowCount ?? 0
  },

  async revokeDevice(email: string, deviceId: string) {
    const { rowCount } = await query(
      `update devices d
          set revoked_at = now(), updated_at = now()
         from users u
        where d.user_id = u.id
          and u.lower_email = $1
          and d.device_id = $2`,
      [email.trim().toLowerCase(), deviceId]
    )
    return rowCount ?? 0
  },
}
