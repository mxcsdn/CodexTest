import pg from 'pg'

const { Pool } = pg

let pool

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL
}

function parseConnectionConfig(connectionString) {
  try {
    const url = new URL(connectionString)
    const database = url.pathname.replace(/^\//, '') || 'postgres'

    return {
      database,
      host: url.hostname,
      password: decodeURIComponent(url.password),
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
    }
  } catch {
    return { connectionString }
  }
}

export function hasDatabaseConfig() {
  return Boolean(getDatabaseUrl())
}

export function getPool() {
  const connectionString = getDatabaseUrl()

  if (!connectionString) {
    throw new Error(
      'Missing DATABASE_URL. Copy .env.example to .env and set your Supabase Session pooler connection string.',
    )
  }

  if (!pool) {
    const needsSsl = connectionString.includes('supabase.com') || connectionString.includes('sslmode=require')

    pool = new Pool({
      application_name: 'todo_list_backend_session_pool',
      ...parseConnectionConfig(connectionString),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    })
  }

  return pool
}
