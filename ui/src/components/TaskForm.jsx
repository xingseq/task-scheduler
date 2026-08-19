/**
 * TaskForm.jsx — 新建/编辑任务弹窗表单
 */

import { useState } from 'react'

// 常用 cron 快捷模板
const CRON_PRESETS = [
  ['*/5 * * * *', '每 5 分钟'],
  ['0 * * * *', '每小时'],
  ['0 9 * * *', '每天 9:00'],
  ['0 9 * * 1-5', '工作日 9:00'],
  ['0 0 * * 0', '每周日 0:00'],
]

function TaskForm({ task, onSave, onClose }) {
  const isEdit = !!task.id
  const isDuplicate = !isEdit && task.duplicate === true
  const [form, setForm] = useState({
    label: task.label || '',
    cron: task.cron || '',
    command: task.command || '',
    cwd: task.cwd || '',
    timeoutSec: task.timeoutSec || 300,
    enabled: task.enabled !== false
  })
  const [saving, setSaving] = useState(false)

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        ...(isEdit ? { id: task.id } : {}),
        ...form,
        cwd: form.cwd.trim() || null,
        timeoutSec: Number(form.timeoutSec) || 300
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4"
      onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold">{isEdit ? '编辑任务' : isDuplicate ? '复制任务' : '新建任务'}</h2>

        <div>
          <label className="block text-sm text-gray-400 mb-1">任务名称（可选）</label>
          <input value={form.label} onChange={e => set('label', e.target.value)}
            placeholder="例如: 每日备份"
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">执行命令 *</label>
          <textarea value={form.command} onChange={e => set('command', e.target.value)}
            placeholder="例如: rsync -a ~/Documents/ ~/Backup/docs/" required rows={3}
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-500" />
          <p className="text-xs text-gray-500 mt-1">通过 /bin/sh -c 执行，支持管道、重定向等 shell 语法</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">cron 表达式 *</label>
          <input value={form.cron} onChange={e => set('cron', e.target.value)}
            placeholder="分 时 日 月 周，例如: 0 9 * * *" required
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-500" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {CRON_PRESETS.map(([expr, name]) => (
              <button key={expr} type="button" onClick={() => set('cron', expr)}
                className={`px-2 py-1 text-xs rounded transition ${
                  form.cron === expr
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">工作目录（可选）</label>
            <input value={form.cwd} onChange={e => set('cwd', e.target.value)}
              placeholder="默认: 用户主目录"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">超时（秒）</label>
            <input type="number" min="1" value={form.timeoutSec}
              onChange={e => set('timeoutSec', e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)}
            className="accent-primary-500" />
          保存后立即启用调度
        </label>
        {isDuplicate && (
          <p className="-mt-2 text-xs text-gray-500">副本默认停用，确认字段无误后可在列表中启用，避免与原任务重复执行</p>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving || !form.command.trim() || !form.cron.trim()}
            className="flex-1 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium text-sm transition">
            {saving ? '保存中...' : '保存'}
          </button>
          <button type="button" onClick={onClose}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
            取消
          </button>
        </div>
      </form>
    </div>
  )
}

export default TaskForm
