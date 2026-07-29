import { useState, useEffect, useCallback } from 'react'
import TaskList from './components/TaskList'
import TaskForm from './components/TaskForm'
import HistoryPage from './components/HistoryPage'

const API_BASE = '/api'

function App() {
  const [connected, setConnected] = useState(null)  // null=检测中
  const [page, setPage] = useState('tasks')         // tasks | history
  const [tasks, setTasks] = useState([])
  const [editing, setEditing] = useState(null)      // null=关闭表单, {}=新建, task=编辑
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/tasks`)
      const data = await r.json()
      setTasks(data.tasks || [])
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }, [])

  // 初始加载 + 每 5s 轮询刷新状态（下次执行时间/执行中标记）
  useEffect(() => {
    loadTasks()
    const timer = setInterval(loadTasks, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  const api = useCallback(async (path, options = {}) => {
    try {
      const r = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      })
      const data = await r.json()
      if (!r.ok) {
        showToast(data.error || '操作失败', true)
        return null
      }
      await loadTasks()
      return data
    } catch (e) {
      showToast(e.message, true)
      return null
    }
  }, [loadTasks, showToast])

  const handleSave = async (form) => {
    const data = form.id
      ? await api(`/tasks/${form.id}`, { method: 'PUT', body: JSON.stringify(form) })
      : await api('/tasks', { method: 'POST', body: JSON.stringify(form) })
    if (data) {
      setEditing(null)
      showToast(form.id ? '任务已更新' : '任务已创建')
    }
  }

  if (connected === false) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">正在连接后端服务...</h1>
          <p className="text-gray-400 text-sm">请确保服务已启动 (端口 8021)</p>
          <button onClick={() => { setConnected(null); loadTasks() }}
            className="mt-4 px-4 py-2 bg-primary-600 rounded hover:bg-primary-500 text-sm">
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold">⏰ 定时任务</h1>
            <nav className="flex gap-1">
              {[['tasks', '任务列表'], ['history', '执行历史']].map(([key, name]) => (
                <button key={key} onClick={() => setPage(key)}
                  className={`px-3 py-1.5 rounded text-sm transition ${
                    page === key
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}>
                  {name}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-green-400">{connected ? '● 已连接' : '连接中...'}</span>
            {page === 'tasks' && (
              <button onClick={() => setEditing({})}
                className="px-4 py-1.5 bg-primary-600 hover:bg-primary-500 rounded text-sm font-medium transition">
                + 新建任务
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {page === 'tasks' ? (
          <TaskList tasks={tasks} api={api} showToast={showToast} onEdit={setEditing} />
        ) : (
          <HistoryPage tasks={tasks} apiBase={API_BASE} />
        )}
      </main>

      {editing !== null && (
        <TaskForm task={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm shadow-lg z-50 ${
          toast.isError ? 'bg-red-600' : 'bg-green-600'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default App
