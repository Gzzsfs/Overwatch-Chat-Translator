import { author as _author, name } from '~/package.json'

const author = _author.name ?? _author
const authorInKebabCase = author.replace(/\s+/g, '-')
const appId = `com.${authorInKebabCase}.${name}`.toLowerCase()

/**
 * @param {string} id
 * @description Create the app id using the name and author from package.json transformed to kebab case if the id is not provided.
 * @default 'com.{author}.{app}' - the author and app comes from package.json
 * @example
 * makeAppId('com.example.app')
 * // => 'com.example.app'
 */
export function makeAppId(id: string = appId): string {
  return id
}

/**
 *
 * @param {number} ms
 * @description Wait for a given number of milliseconds.
 * @example
 * await waitFor(1000) // Waits for 1 second
 */
export function waitFor(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createTimestamp() {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}
