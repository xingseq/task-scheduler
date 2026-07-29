/**
 * TaskList.jsx — 任务列表：状态展示 + 启停/立即执行/编辑/删除
 */

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { hour12: false })
}

function StatusBadge({ task }) {
  if (task.executing) {
    return <span className="px-2 py-0.5 rounded text-xs bg-blue-900/60 text-blue-300 animate-pulse">执行中</span>
  }
  if (!task.enabled) {
    return <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-400">已停用</span>
  }
  if (task.error) {
    return <span className="px-2 py-0.5 rounded text-xs bg-red-900/60 text-red-300" title={task.error}>异常</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs bg-green-900/60 text-green-300">调度中</span>
}

function TaskList({ tasks, api, showToast, onEdit }) {
  const handleToggle = async (task) => {
    const data = await api(`/tasks/${task.id}/${task.enabled ? 'disable' : 'enable'}`, { method: 'POST' })
    if (data) showToast(task.enabled ? '已停用调度' : '已启用调度')
  }

  const handleRun = async (task) => {
    const data = await api(`/tasks/${task.id}/run`, { method: 'POST' })
    if (data) showToast('已触发执行，结果见执行历史')
  }

  const handleKill = async (task) => {
    const data = await api(`/tasks/${task.id}/kill`, { method: 'POST' })
    if (data) showToast('已发送终止信号')
  }

  const handleDelete = async (task) => {
    if (!window.confirm(`确定删除任务「${task.label}」？执行历史将保留。`)) return
    const data = await api(`/tasks/${task.id}`, { method: 'DELETE' })
    if (data) showToast('任务已删除')
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-4xl mb-4">⏰</p>
        <p>还没有定时任务，点击右上角「新建任务」创建一个</p>
        <p className="text-xs mt-2 text-gray-600">例如：每天 9 点执行 <code className="bg-gray-800 px-1 rounded">0 9 * * *</code></p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => (
        <div key={task.id}
          className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium truncate">{task.label}</h3>
                <StatusBadge task={task} />
              </div>
              <code className="block text-xs text-gray-400 bg-gray-900 rounded px-2 py-1 mb-2 overflow-x-auto whitespace-nowrap">
                {task.command}
              </code>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>cron: <code className="text-primary-300">{task.cron}</code></span>
                <span>上次执行: {fmtTime(task.lastRun)}</span>
                <span>下次执行: {fmtTime(task.nextRun)}</span>
                {task.cwd && <span>目录: {task.cwd}</span>}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {task.executing ? (
                <button onClick={() => handleKill(task)}
                  className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800 text-red-300 rounded transition">
                  终止
                </button>
              ) : (
                <button onClick={() => handleRun(task)}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition">
                  立即执行
                </button>
              )}
              <button onClick={() => handleToggle(task)}
                className={`px-3 py-1.5 text-xs rounded transition ${
                  task.enabled
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    : 'bg-green-900/50 hover:bg-green-800 text-green-300'
                }`}>
                {task.enabled ? '停用' : '启用'}
              </button>
              <button onClick={() => onEdit(task)}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition">
                编辑
              </button>
              <button onClick={() => handleDelete(task)}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-red-900/60 hover:text-red-300 rounded transition">
                删除
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default TaskList
