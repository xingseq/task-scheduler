/**
 * task-store.mjs
 * 定时任务持久化 — 任务列表落盘到 ~/.xingseq/task-scheduler/tasks.json
 *
 * 任务结构：
 *   { id, label, cron, command, cwd, timeoutSec, enabled, createdAt, updatedAt }
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'

const DATA_DIR = path.join(os.homedir(), '.xingseq', 'task-scheduler')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')

export const DEFAULT_TIMEOUT_SEC = 300  // 单次执行默认超时 5 分钟

let tasks = null   // 内存缓存，null 表示未加载

async function ensureLoaded() {
  if (tasks) return
  try {
    const raw = await fs.readFile(TASKS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
  } catch {
    tasks = []
  }
}

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(TASKS_FILE, JSON.stringify({ version: 1, tasks }, null, 2))
}

/** 校验任务字段，返回错误消息或 null */
export function validateTask({ cron, command, cwd, timeoutSec }) {
  if (!command || !command.trim()) return 'command 不能为空'
  if (!cron || !cron.trim()) return 'cron 表达式不能为空'
  try {
    // 仅做语法校验，立即销毁避免遗留定时器
    new Cron(cron.trim(), { paused: true }).stop()
  } catch (err) {
    return `cron 表达式无效: ${err.message}`
  }
  if (cwd && !path.isAbsolute(cwd)) return 'cwd 必须是绝对路径'
  if (timeoutSec !== undefined && timeoutSec !== null) {
    const n = Number(timeoutSec)
    if (!Number.isFinite(n) || n <= 0) return 'timeoutSec 必须是正数'
  }
  return null
}

export async function listTasks() {
  await ensureLoaded()
  return [...tasks]
}

export async function getTask(id) {
  await ensureLoaded()
  return tasks.find(t => t.id === id) || null
}

export async function createTask({ label, cron, command, cwd, timeoutSec, enabled }) {
  await ensureLoaded()
  const now = new Date().toISOString()
  const task = {
    id: randomUUID(),
    label: (label || '').trim() || command.trim().slice(0, 40),
    cron: cron.trim(),
    command: command.trim(),
    cwd: cwd ? path.resolve(cwd) : null,
    timeoutSec: timeoutSec ? Number(timeoutSec) : DEFAULT_TIMEOUT_SEC,
    enabled: enabled !== false,
    createdAt: now,
    updatedAt: now
  }
  tasks.push(task)
  await persist()
  return task
}

export async function updateTask(id, patch) {
  await ensureLoaded()
  const task = tasks.find(t => t.id === id)
  if (!task) return null
  const allowed = ['label', 'cron', 'command', 'cwd', 'timeoutSec', 'enabled']
  for (const key of allowed) {
    if (patch[key] !== undefined) task[key] = patch[key]
  }
  if (patch.cron) task.cron = patch.cron.trim()
  if (patch.command) task.command = patch.command.trim()
  if (patch.cwd) task.cwd = path.resolve(patch.cwd)
  if (patch.timeoutSec) task.timeoutSec = Number(patch.timeoutSec)
  task.updatedAt = new Date().toISOString()
  await persist()
  return task
}

export async function deleteTask(id) {
  await ensureLoaded()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return false
  tasks.splice(idx, 1)
  await persist()
  return true
}
