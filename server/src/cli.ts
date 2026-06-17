import { authCli } from './auth.js'
import { pool } from './db.js'

const [command, ...args] = process.argv.slice(2)

function usage(): never {
  console.error(`Usage:
  npm run create-user -- <email> <password> [displayName]
  npm run reset-password -- <email> <password>
  npm run disable-user -- <email>
  npm run enable-user -- <email>
  npm run revoke-device -- <email> <deviceId>`)
  process.exit(2)
}

try {
  if (command === 'create-user') {
    const [email, password, displayName] = args
    if (!email || !password) {
      usage()
    }

    const user = await authCli.createUser(email, password, displayName)
    console.log(`Created user ${user.email} (${user.id}).`)
  } else if (command === 'reset-password') {
    const [email, password] = args
    if (!email || !password) {
      usage()
    }

    const count = await authCli.resetPassword(email, password)
    console.log(`Updated ${count} user(s).`)
  } else if (command === 'disable-user' || command === 'enable-user') {
    const [email] = args
    if (!email) {
      usage()
    }

    const count = await authCli.setUserStatus(
      email,
      command === 'enable-user' ? 'active' : 'disabled'
    )
    console.log(`Updated ${count} user(s).`)
  } else if (command === 'revoke-device') {
    const [email, deviceId] = args
    if (!email || !deviceId) {
      usage()
    }

    const count = await authCli.revokeDevice(email, deviceId)
    console.log(`Revoked ${count} device(s).`)
  } else {
    usage()
  }
} finally {
  await pool.end()
}
