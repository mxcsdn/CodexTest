function toIsoDateTime(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function toServerTodo(todo) {
  return {
    clientTaskId: todo.id,
    title: todo.title,
    notes: todo.notes || '',
    dueAt: toIsoDateTime(todo.dueAt),
    priority: todo.priority || 'medium',
    completed: Boolean(todo.completed),
    reminded: Boolean(todo.reminded),
    clientCreatedAt: toIsoDateTime(todo.createdAt || Date.now()),
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    let message = `Request failed with ${response.status}`

    try {
      const data = await response.json()
      message = data.detail || data.error || message
    } catch {
      // Keep the generic message if the server did not return JSON.
    }

    throw new Error(message)
  }

  if (response.status === 204) return null

  return response.json()
}

export async function fetchTodos() {
  const data = await requestJson('/api/todos')
  return data.todos
}

export async function syncTodos(todos) {
  const data = await requestJson('/api/todos/sync', {
    method: 'POST',
    body: JSON.stringify({ todos: todos.map(toServerTodo) }),
  })

  return data.todos
}

export async function createTodo(todo) {
  const data = await requestJson('/api/todos', {
    method: 'POST',
    body: JSON.stringify(toServerTodo(todo)),
  })

  return data.todo
}

export async function updateTodo(id, patch) {
  const body = { ...patch }

  if (Object.hasOwn(body, 'dueAt')) {
    body.dueAt = toIsoDateTime(body.dueAt)
  }

  const data = await requestJson(`/api/todos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

  return data.todo
}

export async function postponeTodo(id, minutes) {
  const data = await requestJson(`/api/todos/${id}/postpone`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })

  return data.todo
}

export async function deleteTodo(id) {
  await requestJson(`/api/todos/${id}`, {
    method: 'DELETE',
  })
}
