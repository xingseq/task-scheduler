/**
 * HistoryPage.jsx — 执行历史：按任务筛选 + 展开查看输出
 */

import { useState, useEffect, useCallback } from 'react'

const STATUS_STYLE = {
  success: 'bg-green-900/60 text-green-300',
  failed: 'bg-red-900/60 text-red-300',
  timeout: 'bg-orange-900/60 text-orange-300',
  running: 'bg-blue-900/60 text-blue-300 animate-pulse',
  interrupted: 'bg-gray-700 text-gray-400',
}

const STATUS_NAME = {
  success: '成功',
  failed: '失败',
  timeout: '超时',
  running: '执行中',
  interrupted: '中断',
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function fmtDuration(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

function HistoryPage({ tasks, apiBase }) {
  const [records, setRecords] = useState([])
  const [filterTaskId, setFilterTaskId] = useState('')
  const [expanded, setExpanded] = useState(null)  // 展开的记录 id
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const query = filterTaskId ? `?taskId=${filterTaskId}&limit=100` : '?limit=100'
      const r = await fetch(`${apiBase}/history${query}`)
      const data = await r.json()
      setRecords(data.records || [])
    } catch { /* 轮询失败静默，下轮重试 */ }
    setLoading(false)
  }, [apiBase, filterTaskId])

  // 初始加载 + 每 5s 轮询（捕获 running → 结束的状态变化）
  useEffect(() => {
    setLoading(true)
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  const handleClear = async () => {
    if (!window.confirm(filterTaskId ? '确定清空该任务的执行历史？' : '确定清空全部执行历史？')) return
    const query = filterTaskId ? `?taskId=${filterTaskId}` : ''
    await fetch(`${apiBase}/history${query}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <select value={filterTaskId} onChange={e => setFilterTaskId(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary-500">
          <option value="">全部任务</option>
          {tasks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button onClick={handleClear} disabled={records.length === 0}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-red-900/60 hover:text-red-300 disabled:opacity-40 rounded transition">
          清空历史
        </button>
      </div>

      {loading ? (
        <p className="text-center py-20 text-gray-500">加载中...</p>
      ) : records.length === 0 ? (
        <p className="text-center py-20 text-gray-500">暂无执行记录</p>
      ) : (
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-750 transition">
                <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${STATUS_STYLE[r.status] || STATUS_STYLE.interrupted}`}>
                  {STATUS_NAME[r.status] || r.status}
                </span>
                <span className="font-medium text-sm truncate">{r.taskLabel}</span>
                <span className="text-xs text-gray-500 shrink-0">
                  {r.trigger === 'manual' ? '手动' : '定时'}
                </span>
                <span className="text-xs text-gray-500 ml-auto shrink-0">
                  {fmtTime(r.startedAt)} · 耗时 {fmtDuration(r.durationMs)}
                  {r.exitCode !== null && r.exitCode !== 0 && ` · code=${r.exitCode}`}
                </span>
                <span className="text-gray-500 text-xs shrink-0">{expanded === r.id ? '▲' : '▼'}</span>
              </button>
              {expanded === r.id && (
                <div className="border-t border-gray-700 px-4 py-3">
                  <code className="block text-xs text-gray-400 bg-gray-900 rounded px-2 py-1 mb-2 overflow-x-auto whitespace-nowrap">
                    $ {r.command}
                  </code>
                  <pre className="text-xs text-gray-300 bg-gray-900 rounded p-3 max-h-80 overflow-auto whitespace-pre-wrap">
                    {r.output || '（无输出）'}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default HistoryPage
