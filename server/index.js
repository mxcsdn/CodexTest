import dotenv from 'dotenv'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, hasDatabaseConfig } from './db.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = Number(process.env.PORT || 5173)
const isProduction = process.env.NODE_ENV === 'production'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const priorities = new Set(['high', 'medium', 'low'])

app.use(express.json({ limit: '1mb' }))

function assertUuid(value, fieldName = 'id') {
  if (!uuidPattern.test(String(value))) {
    const error = new Error(`${fieldName} must be a valid UUID`)
    error.status = 400
    throw error
  }
}

function toTimestamp(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date`)
    error.status = 400
    throw error
  }

  return date.toISOString()
}

function normalizeTodoPayload(body) {
  const clientTaskId = body.clientTaskId || body.id
  assertUuid(clientTaskId, 'clientTaskId')

  const title = String(body.title || '').trim()
  if (!title) {
    const error = new Error('title is required')
    error.status = 400
    throw error
  }

  const priority = body.priority || 'medium'
  if (!priorities.has(priority)) {
    const error = new Error('priority must be high, medium, or low')
    error.status = 400
    throw error
  }

  return {
    clientTaskId,
    title,
    notes: String(body.notes || '').trim(),
    dueAt: toTimestamp(body.dueAt, 'dueAt'),
    priority,
    completed: Boolean(body.completed),
    reminded: Boolean(body.reminded),
    clientCreatedAt: toTimestamp(body.clientCreatedAt ?? body.createdAt, 'clientCreatedAt'),
  }
}

function mapTodo(row) {
  const createdAt = row.client_created_at || row.created_at

  return {
    id: row.client_task_id,
    cloudId: row.id,
    title: row.title,
    notes: row.notes || '',
    dueAt: row.due_at ? row.due_at.toISOString() : '',
    priority: row.priority,
    completed: row.completed,
    createdAt: createdAt ? new Date(createdAt).getTime() : Date.now(),
    reminded: row.reminded,
  }
}

async function upsertTodo(client, todo) {
  const result = await client.query(
    `
      insert into public.cloud_todo_tasks (
        client_task_id,
        title,
        notes,
        due_at,
        priority,
        completed,
        reminded,
        client_created_at,
        source
      )
      values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8::timestamptz, 'todo_list_web')
      on conflict (client_task_id) do update set
        title = excluded.title,
        notes = excluded.notes,
        due_at = excluded.due_at,
        priority = excluded.priority,
        completed = excluded.completed,
        reminded = excluded.reminded,
        client_created_at = coalesce(public.cloud_todo_tasks.client_created_at, excluded.client_created_at),
        deleted_at = null,
        source = excluded.source
      returning *
    `,
    [
      todo.clientTaskId,
      todo.title,
      todo.notes,
      todo.dueAt,
      todo.priority,
      todo.completed,
      todo.reminded,
      todo.clientCreatedAt,
    ],
  )

  return result.rows[0]
}

async function listTodos() {
  const result = await getPool().query(`
    select *
    from public.cloud_todo_tasks
    where deleted_at is null
    order by
      completed asc,
      due_at asc nulls last,
      coalesce(client_created_at, created_at) desc
  `)

  return result.rows.map(mapTodo)
}

app.get('/api/health', async (request, response, next) => {
  try {
    if (!hasDatabaseConfig()) {
      response.json({ ok: true, databaseConfigured: false })
      return
    }

    await getPool().query('select 1')
    response.json({ ok: true, databaseConfigured: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/todos', async (request, response, next) => {
  try {
    response.json({ todos: await listTodos() })
  } catch (error) {
    next(error)
  }
})

app.post('/api/todos/sync', async (request, response, next) => {
  const client = await getPool().connect()

  try {
    const todos = Array.isArray(request.body.todos) ? request.body.todos : []
    const normalizedTodos = todos.map(normalizeTodoPayload)

    await client.query('begin')
    for (const todo of normalizedTodos) {
      await upsertTodo(client, todo)
    }
    await client.query('commit')

    response.json({ todos: await listTodos() })
  } catch (error) {
    await client.query('rollback')
    next(error)
  } finally {
    client.release()
  }
})

app.post('/api/todos', async (request, response, next) => {
  const client = await getPool().connect()

  try {
    const todo = normalizeTodoPayload(request.body)
    const row = await upsertTodo(client, todo)
    response.status(201).json({ todo: mapTodo(row) })
  } catch (error) {
    next(error)
  } finally {
    client.release()
  }
})

app.patch('/api/todos/:id', async (request, response, next) => {
  try {
    assertUuid(request.params.id)

    const assignments = []
    const values = []

    if (Object.hasOwn(request.body, 'title')) {
      const title = String(request.body.title || '').trim()
      if (!title) {
        const error = new Error('title is required')
        error.status = 400
        throw error
      }
      values.push(title)
      assignments.push(`title = $${values.length}`)
    }

    if (Object.hasOwn(request.body, 'notes')) {
      values.push(String(request.body.notes || '').trim())
      assignments.push(`notes = $${values.length}`)
    }

    if (Object.hasOwn(request.body, 'dueAt')) {
      values.push(toTimestamp(request.body.dueAt, 'dueAt'))
      assignments.push(`due_at = $${values.length}::timestamptz`)
    }

    if (Object.hasOwn(request.body, 'priority')) {
      if (!priorities.has(request.body.priority)) {
        const error = new Error('priority must be high, medium, or low')
        error.status = 400
        throw error
      }
      values.push(request.body.priority)
      assignments.push(`priority = $${values.length}`)
    }

    if (Object.hasOwn(request.body, 'completed')) {
      values.push(Boolean(request.body.completed))
      assignments.push(`completed = $${values.length}`)
    }

    if (Object.hasOwn(request.body, 'reminded')) {
      values.push(Boolean(request.body.reminded))
      assignments.push(`reminded = $${values.length}`)
    }

    if (assignments.length === 0) {
      const error = new Error('No supported fields to update')
      error.status = 400
      throw error
    }

    values.push(request.params.id)
    const result = await getPool().query(
      `
        update public.cloud_todo_tasks
        set ${assignments.join(', ')}
        where client_task_id = $${values.length}
          and deleted_at is null
        returning *
      `,
      values,
    )

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Todo not found' })
      return
    }

    response.json({ todo: mapTodo(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/todos/:id/postpone', async (request, response, next) => {
  try {
    assertUuid(request.params.id)

    const minutes = Number(request.body.minutes || 15)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      const error = new Error('minutes must be between 1 and 1440')
      error.status = 400
      throw error
    }

    const result = await getPool().query(
      `
        update public.cloud_todo_tasks
        set
          due_at = now() + ($2::int * interval '1 minute'),
          reminded = false
        where client_task_id = $1
          and deleted_at is null
        returning *
      `,
      [request.params.id, Math.round(minutes)],
    )

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Todo not found' })
      return
    }

    response.json({ todo: mapTodo(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/todos/:id', async (request, response, next) => {
  try {
    assertUuid(request.params.id)

    const result = await getPool().query(
      `
        update public.cloud_todo_tasks
        set deleted_at = now()
        where client_task_id = $1
          and deleted_at is null
        returning id
      `,
      [request.params.id],
    )

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Todo not found' })
      return
    }

    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }

  const status = error.status || 500
  response.status(status).json({
    error: status === 500 ? 'Server error' : error.message,
    detail: status === 500 ? error.message : undefined,
  })
})

if (isProduction) {
  const distPath = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distPath))
  app.use((request, response) => {
    if (request.method === 'GET' && !request.path.startsWith('/api')) {
      response.sendFile(path.join(distPath, 'index.html'))
      return
    }

    response.status(404).end()
  })
} else {
  const vite = await createViteServer({
    appType: 'spa',
    server: { middlewareMode: true },
  })
  app.use(vite.middlewares)
}

app.listen(port, () => {
  console.log(`Todo app is running at http://localhost:${port}`)
})
