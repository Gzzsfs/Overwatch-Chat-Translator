import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pool } from './db.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(currentDir, 'schema.sql')
const schema = readFileSync(schemaPath, 'utf8')

await pool.query(schema)
await pool.end()
console.log('Database migration completed.')
