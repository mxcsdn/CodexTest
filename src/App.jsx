import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTodo,
  deleteTodo as deleteCloudTodo,
  fetchTodos,
  postponeTodo as postponeCloudTodo,
  syncTodos,
  updateTodo,
} from './api'
import './App.css'

const STORAGE_KEY = 'todo-reminder-items'
const INITIAL_NOW = Date.now()
const SYNCED_STORAGE_KEY = `${STORAGE_KEY}-cloud-synced`

const priorityOptions = [
  { value: 'high', label: '高', tone: 'priority-high' },
  { value: 'medium', label: '中', tone: 'priority-medium' },
  { value: 'low', label: '低', tone: 'priority-low' },
]

const golfTodo = {
  title: '预约高尔夫球运动提醒',
  notes: '提前 30 分钟准备球杆、手套和球鞋后出门',
}

const seedTodos = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: '整理本周任务',
    notes: '把重要工作拆成可以执行的小步骤',
    dueAt: getLocalDateTime(3),
    priority: 'high',
    completed: true,
    createdAt: Date.now(),
    reminded: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: golfTodo.title,
    notes: golfTodo.notes,
    dueAt: getSpecificLocalDateTime(5, 20, 9, 30),
    priority: 'medium',
    completed: false,
    createdAt: Date.now(),
    reminded: false,
  },
]

function migrateStoredTodos(todos) {
  if (!Array.isArray(todos)) return seedTodos

  let changed = false
  const migratedTodos = todos.map((todo, index) => {
    let nextTodo = todo

    if (todo.title === '预约健身提醒') {
      changed = true
      nextTodo = {
        ...nextTodo,
        title: golfTodo.title,
        notes: todo.notes === '提前 30 分钟准备出门' ? golfTodo.notes : todo.notes,
      }
    }

    if (index === 0 && todo.title === '整理本周任务' && !todo.completed) {
      changed = true
      nextTodo = {
        ...nextTodo,
        completed: true,
      }
    }

    return nextTodo
  })

  return changed ? migratedTodos : todos
}

function getLocalDateTime(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60 * 1000)
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function getSpecificLocalDateTime(month, day, hour = 0, minute = 0) {
  const currentYear = new Date().getFullYear()
  const date = new Date(currentYear, month - 1, day, hour, minute, 0, 0)
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function formatDateTime(value) {
  if (!value) return '未设置'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getTodoStatus(todo, now) {
  if (todo.completed) return 'completed'
  if (!todo.dueAt) return 'open'

  const dueTime = new Date(todo.dueAt).getTime()
  const minutesLeft = Math.round((dueTime - now) / 60000)

  if (minutesLeft < 0) return 'overdue'
  if (minutesLeft <= 30) return 'soon'
  return 'open'
}

function getStatusLabel(status) {
  const labels = {
    completed: '已完成',
    overdue: '已逾期',
    soon: '即将到期',
    open: '待处理',
  }

  return labels[status]
}

function App() {
  const [todos, setTodos] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? migrateStoredTodos(JSON.parse(saved)) : seedTodos
    } catch {
      return seedTodos
    }
  })
  const [form, setForm] = useState({
    title: '',
    notes: '',
    dueAt: getLocalDateTime(60),
    priority: 'medium',
  })
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(INITIAL_NOW)
  const [toast, setToast] = useState('')
  const [isCloudReady, setIsCloudReady] = useState(false)
  const todosRef = useRef(todos)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  useEffect(() => {
    let ignore = false

    async function loadCloudTodos() {
      try {
        const localTodos = todosRef.current
        const hasSynced = localStorage.getItem(SYNCED_STORAGE_KEY) === 'true'
        const cloudTodos = hasSynced ? await fetchTodos() : await syncTodos(localTodos)

        if (ignore) return

        setTodos(cloudTodos.length > 0 ? cloudTodos : localTodos)
        localStorage.setItem(SYNCED_STORAGE_KEY, 'true')
        setIsCloudReady(true)
      } catch (error) {
        if (ignore) return

        setIsCloudReady(false)
        setToast(`云端同步失败：${error.message}`)
      }
    }

    loadCloudTodos()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    const tick = async () => {
      const currentTime = Date.now()
      setNow(currentTime)

      const dueTodos = todosRef.current.filter((todo) => {
        if (todo.completed || todo.reminded || !todo.dueAt) return false
        return new Date(todo.dueAt).getTime() <= currentTime
      })

      if (dueTodos.length === 0) return

      const dueIds = new Set(dueTodos.map((todo) => todo.id))
      const previousTodos = todosRef.current
      setTodos((currentTodos) =>
        currentTodos.map((todo) =>
          dueIds.has(todo.id) ? { ...todo, reminded: true } : todo,
        ),
      )

      try {
        await Promise.all(dueTodos.map((todo) => updateTodo(todo.id, { reminded: true })))
      } catch (error) {
        setTodos(previousTodos)
        setToast(`云端提醒状态更新失败：${error.message}`)
        return
      }

      setToast(`${dueTodos[0].title} 已到提醒时间`)

      if ('Notification' in window && Notification.permission === 'granted') {
        dueTodos.forEach((todo) => {
          new Notification('待办提醒', {
            body: `${todo.title} 已到提醒时间`,
          })
        })
      }
    }

    const timer = window.setInterval(tick, 30000)
    const startupTimer = window.setTimeout(tick, 0)

    return () => {
      window.clearInterval(timer)
      window.clearTimeout(startupTimer)
    }
  }, [])

  const stats = useMemo(() => {
    return todos.reduce(
      (result, todo) => {
        const status = getTodoStatus(todo, now)
        result.total += 1
        result[status] += 1
        return result
      },
      { total: 0, open: 0, soon: 0, overdue: 0, completed: 0 },
    )
  }, [todos, now])

  const filteredTodos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return todos
      .filter((todo) => {
        const status = getTodoStatus(todo, now)
        const matchesFilter = filter === 'all' || status === filter
        const matchesQuery =
          normalizedQuery.length === 0 ||
          todo.title.toLowerCase().includes(normalizedQuery) ||
          todo.notes.toLowerCase().includes(normalizedQuery)

        return matchesFilter && matchesQuery
      })
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        if (!a.dueAt && !b.dueAt) return b.createdAt - a.createdAt
        if (!a.dueAt) return 1
        if (!b.dueAt) return -1
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      })
  }, [filter, now, query, todos])

  const nextTodo = useMemo(() => {
    return todos
      .filter((todo) => !todo.completed && todo.dueAt)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]
  }, [todos])

  async function handleSubmit(event) {
    event.preventDefault()

    const title = form.title.trim()
    if (!title) {
      setToast('请先填写待办标题')
      return
    }

    const todo = {
      id: crypto.randomUUID(),
      title,
      notes: form.notes.trim(),
      dueAt: form.dueAt,
      priority: form.priority,
      completed: false,
      createdAt: Date.now(),
      reminded: false,
    }

    const previousTodos = todos
    setTodos((currentTodos) => [todo, ...currentTodos])

    try {
      const savedTodo = await createTodo(todo)
      setTodos((currentTodos) =>
        currentTodos.map((currentTodo) => (currentTodo.id === todo.id ? savedTodo : currentTodo)),
      )
      setForm({
        title: '',
        notes: '',
        dueAt: getLocalDateTime(60),
        priority: 'medium',
      })
      setIsCloudReady(true)
      setToast('已添加待办并写入云端')
    } catch (error) {
      setTodos(previousTodos)
      setIsCloudReady(false)
      setToast(`云端写入失败：${error.message}`)
    }
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) {
      setToast('当前浏览器不支持系统通知')
      return
    }

    Notification.requestPermission().then((permission) => {
      setToast(permission === 'granted' ? '系统通知已开启' : '系统通知未开启')
    })
  }

  async function toggleTodo(id) {
    const todo = todos.find((item) => item.id === id)
    if (!todo) return

    const nextCompleted = !todo.completed
    const previousTodos = todos

    setTodos((currentTodos) =>
      currentTodos.map((todo) =>
        todo.id === id ? { ...todo, completed: nextCompleted } : todo,
      ),
    )

    try {
      const savedTodo = await updateTodo(id, { completed: nextCompleted })
      setTodos((currentTodos) =>
        currentTodos.map((currentTodo) => (currentTodo.id === id ? savedTodo : currentTodo)),
      )
      setIsCloudReady(true)
    } catch (error) {
      setTodos(previousTodos)
      setIsCloudReady(false)
      setToast(`云端状态更新失败：${error.message}`)
    }
  }

  async function deleteTodo(id) {
    const previousTodos = todos
    setTodos((currentTodos) => currentTodos.filter((todo) => todo.id !== id))

    try {
      await deleteCloudTodo(id)
      setIsCloudReady(true)
      setToast('已从云端删除')
    } catch (error) {
      setTodos(previousTodos)
      setIsCloudReady(false)
      setToast(`云端删除失败：${error.message}`)
    }
  }

  async function postponeTodo(id, minutes) {
    const previousTodos = todos
    const fallbackDueAt = getLocalDateTime(minutes)

    setTodos((currentTodos) =>
      currentTodos.map((todo) =>
        todo.id === id
          ? { ...todo, dueAt: fallbackDueAt, reminded: false }
          : todo,
      ),
    )

    try {
      const savedTodo = await postponeCloudTodo(id, minutes)
      setTodos((currentTodos) =>
        currentTodos.map((currentTodo) => (currentTodo.id === id ? savedTodo : currentTodo)),
      )
      setIsCloudReady(true)
      setToast(`已推迟 ${minutes} 分钟并写入云端`)
    } catch (error) {
      setTodos(previousTodos)
      setIsCloudReady(false)
      setToast(`云端推迟失败：${error.message}`)
    }
  }

  return (
    <main className="app-shell">
      <section className="top-bar" aria-label="待办提醒概览">
        <div>
          <p className="eyebrow">Todo Reminder</p>
          <h1>待办事项提醒</h1>
        </div>
        <button
          className="ghost-button"
          type="button"
          aria-label={isCloudReady ? '开启系统通知，云端已连接' : '开启系统通知，云端未连接'}
          onClick={requestNotificationPermission}
        >
          开启系统通知
        </button>
      </section>

      <section className="summary-grid" aria-label="任务统计">
        <div className="metric-card">
          <span>总任务</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="metric-card warning">
          <span>即将到期</span>
          <strong>{stats.soon}</strong>
        </div>
        <div className="metric-card danger">
          <span>已逾期</span>
          <strong>{stats.overdue}</strong>
        </div>
        <div className="metric-card success">
          <span>已完成</span>
          <strong>{stats.completed}</strong>
        </div>
      </section>

      <section className="workspace">
        <form className="task-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">New Task</p>
            <h2>添加提醒</h2>
          </div>

          <label>
            <span>提醒时间</span>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
            />
          </label>

          <label>
            <span>待办标题</span>
            <input
              type="text"
              placeholder="例如：下午三点提交周报"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>

          <label>
            <span>备注</span>
            <textarea
              placeholder="补充地点、资料或准备事项"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>

          <label>
            <span>优先级</span>
            <select
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            >
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-button" type="submit">
            添加待办
          </button>
        </form>

        <section className="task-panel">
          <div className="panel-header">
            <div className="section-heading">
              <p className="eyebrow">Task List</p>
              <h2>任务列表</h2>
            </div>
            <div className="next-reminder">
              <span>下一条提醒</span>
              <strong>{nextTodo ? formatDateTime(nextTodo.dueAt) : '暂无'}</strong>
            </div>
          </div>

          <div className="toolbar" aria-label="任务筛选">
            <input
              type="search"
              placeholder="搜索标题或备注"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="segmented-control">
              {[
                ['all', '全部'],
                ['open', '待处理'],
                ['soon', '即将到期'],
                ['overdue', '逾期'],
                ['completed', '完成'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  type="button"
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="todo-list">
            {filteredTodos.length > 0 ? (
              filteredTodos.map((todo) => {
                const status = getTodoStatus(todo, now)
                const priority = priorityOptions.find((option) => option.value === todo.priority)

                return (
                  <article className={`todo-item ${status}`} key={todo.id}>
                    <button
                      className="check-button"
                      type="button"
                      aria-label={todo.completed ? '标记为未完成' : '标记为完成'}
                      onClick={() => toggleTodo(todo.id)}
                    >
                      {todo.completed ? '✓' : ''}
                    </button>

                    <div className="todo-content">
                      <div className="todo-title-row">
                        <h3>{todo.title}</h3>
                        <span className={`priority-pill ${priority.tone}`}>
                          {priority.label}优先级
                        </span>
                      </div>
                      {todo.notes && <p>{todo.notes}</p>}
                      <div className="todo-meta">
                        <span>{formatDateTime(todo.dueAt)}</span>
                        <span>{getStatusLabel(status)}</span>
                      </div>
                    </div>

                    <div className="todo-actions">
                      {!todo.completed && (
                        <button type="button" onClick={() => postponeTodo(todo.id, 15)}>
                          推迟15分钟
                        </button>
                      )}
                      <button className="delete-button" type="button" onClick={() => deleteTodo(todo.id)}>
                        删除
                      </button>
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="empty-state">
                <strong>没有匹配的待办</strong>
                <span>换个筛选条件，或添加一条新的提醒。</span>
              </div>
            )}
          </div>
        </section>
      </section>

      {toast && (
        <button className="toast" type="button" onClick={() => setToast('')}>
          {toast}
        </button>
      )}
    </main>
  )
}

export default App
