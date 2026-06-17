import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

export function newId() {
  return randomUUID()
}

export function newDeviceToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}
