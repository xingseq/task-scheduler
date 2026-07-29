/**
 * scheduler-engine.mjs
 * 核心调度引擎 — 每个启用任务一个 croner Cron 实例 + spawn 执行命令
 *
 * 行为规范：
 *   - cron 触发 → spawn('/bin/sh -c <command>') 执行，捕获 stdout/stderr
 *   - 上一次未跑完则跳过本次触发（不并发执行同一任务）
 *   - 超时（task.timeoutSec）→ SIGTERM，2s 后仍未退出 → SIGKILL
 *   - 每次执行生成历史记录，落盘 ~/.xingseq/task-scheduler/history.json
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Cron } from 'croner'

const DATA_DIR = path.join(os.homedir(), '.xingseq', 'task-scheduler')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')

const MAX_LOGS = 500          // 每任务日志环形缓冲上限
const MAX_HISTORY = 500       // 历史记录落盘上限（超出丢弃最旧）
const MAX_OUTPUT_CHARS = 20_000  // 单条历史记录保留的输出尾部长度

/** taskId → runtime { job, proc, runId, logs, emitter, lastRun, error } */
const runtimes = new Map()

// ── 日志（内存环形缓冲 + SSE 订阅）──────────────────────────────────────────────

function ensureRuntime(taskId) {
  let rt = runtimes.get(taskId)
  if (!rt) {
    rt = {
      job: null, proc: null, runId: null,
      logs: [], emitter: new EventEmitter(), lastRun: null, error: null
    }
    rt.emitter.setMaxListeners(50)
    runtimes.set(taskId, rt)
  }
  return rt
}

function log(taskId, level, message) {
  const rt = ensureRuntime(taskId)
  const entry = { ts: new Date().toISOString(), level, message }
  rt.logs.push(entry)
  if (rt.logs.length > MAX_LOGS) rt.logs.splice(0, rt.logs.length - MAX_LOGS)
  rt.emitter.emit('log', entry)
}

export function getLogs(taskId, limit = 200) {
  const rt = runtimes.get(taskId)
  if (!rt) return []
  return rt.logs.slice(-limit)
}

/** 订阅实时日志，返回取消函数（供 SSE 使用） */
export function subscribeLogs(taskId, listener) {
  const rt = ensureRuntime(taskId)
  rt.emitter.on('log', listener)
  return () => rt.emitter.off('log', listener)
}

export function getStatus(taskId) {
  const rt = runtimes.get(taskId)
  return {
    scheduled: !!(rt && rt.job),
    executing: !!(rt && rt.proc),
    lastRun: rt ? rt.lastRun : null,
    nextRun: rt && rt.job ? (rt.job.nextRun()?.toISOString() ?? null) : null,
    error: rt ? rt.error : null
  }
}

// ── 执行历史（落盘）────────────────────────────────────────────────────────────

let history = null   // 内存缓存，null 表示未加载

async function ensureHistoryLoaded() {
  if (history) return
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    history = Array.isArray(parsed.records) ? parsed.records : []
    // 服务上次异常退出可能遗留 running 状态，统一标记为 interrupted
    for (const r of history) {
      if (r.status === 'running') {
        r.status = 'interrupted'
        r.finishedAt = r.finishedAt || new Date().toISOString()
      }
    }
  } catch {
    history = []
  }
}

async function persistHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(HISTORY_FILE, JSON.stringify({ version: 1, records: history }, null, 2))
}

/** 查询历史，taskId 为空则返回全部 */
export async function getHistory({ taskId, limit = 100 } = {}) {
  await ensureHistoryLoaded()
  let records = taskId ? history.filter(r => r.taskId === taskId) : history
  return records.slice(-limit).reverse()  // 最新在前
}

export async function clearHistory(taskId) {
  await ensureHistoryLoaded()
  history = taskId ? history.filter(r => r.taskId !== taskId) : []
  await persistHistory()
}

// ── 命令执行 ──────────────────────────────────────────────────────────────────

/** 执行一次任务命令，返回历史记录（同一任务不并发，正在执行则跳过） */
export async function runTask(task, trigger = 'cron') {
  const rt = ensureRuntime(task.id)
  if (rt.proc) {
    log(task.id, 'NOTICE', `上一次执行尚未结束，跳过本次${trigger === 'cron' ? '定时' : '手动'}触发`)
    return null
  }

  await ensureHistoryLoaded()
  const record = {
    id: randomUUID(),
    taskId: task.id,
    taskLabel: task.label,
    command: task.command,
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',   // running | success | failed | timeout | interrupted
    exitCode: null,
    durationMs: null,
    output: ''
  }
  history.push(record)
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
  await persistHistory()

  log(task.id, 'RUN', `开始执行 (${trigger}): ${task.command}`)
  const startMs = Date.now()

  const child = spawn('/bin/sh', ['-c', task.command], {
    cwd: task.cwd || os.homedir(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true   // 独立进程组，便于超时整组 kill
  })
  rt.proc = child
  rt.runId = record.id

  let output = ''
  const append = (chunk, isErr) => {
    const text = chunk.toString()
    output += text
    if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS)
    for (const line of text.split('\n')) {
      if (line.trim()) log(task.id, isErr ? 'STDERR' : 'STDOUT', line)
    }
  }
  child.stdout.on('data', d => append(d, false))
  child.stderr.on('data', d => append(d, true))

  const timeoutMs = (task.timeoutSec || 300) * 1000
  let timedOut = false
  const killTimer = setTimeout(() => {
    timedOut = true
    log(task.id, 'ERROR', `执行超时（${task.timeoutSec}s），发送 SIGTERM`)
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出 */ }
    }, 2000).unref()
  }, timeoutMs)

  return new Promise((resolve) => {
    const finish = async (code, errMsg) => {
      clearTimeout(killTimer)
      rt.proc = null
      rt.runId = null
      rt.lastRun = new Date().toISOString()

      record.finishedAt = rt.lastRun
      record.durationMs = Date.now() - startMs
      record.exitCode = code
      record.output = (errMsg ? output + '\n' + errMsg : output).slice(-MAX_OUTPUT_CHARS).trim()
      record.status = timedOut ? 'timeout' : (code === 0 ? 'success' : 'failed')

      if (record.status === 'success') {
        rt.error = null
        log(task.id, 'INFO', `执行成功 (耗时 ${record.durationMs}ms)`)
      } else {
        rt.error = timedOut ? '上次执行超时' : `上次执行失败 (code=${code})`
        log(task.id, 'ERROR', `执行${timedOut ? '超时' : '失败'} (code=${code}, 耗时 ${record.durationMs}ms)`)
      }
      await persistHistory().catch(() => {})
      resolve(record)
    }
    child.on('close', code => { finish(code) })
    child.on('error', err => { finish(-1, `spawn 失败: ${err.message}`) })
  })
}

/** 手动停止正在执行的命令 */
export function killRun(taskId) {
  const rt = runtimes.get(taskId)
  if (!rt || !rt.proc) return { ok: true, already: true }
  log(taskId, 'NOTICE', '手动终止执行')
  try { process.kill(-rt.proc.pid, 'SIGTERM') } catch { rt.proc.kill('SIGTERM') }
  return { ok: true }
}

// ── 调度启停 ──────────────────────────────────────────────────────────────────

/** 启用任务调度（幂等，cron 变更时先 unschedule 再调用） */
export function scheduleTask(task) {
  const rt = ensureRuntime(task.id)
  if (rt.job) return { ok: true, already: true }
  try {
    rt.job = new Cron(task.cron, () => {
      runTask(task, 'cron').catch(err => log(task.id, 'ERROR', `执行异常: ${err.message}`))
    })
  } catch (err) {
    return { ok: false, error: `cron 表达式无效: ${err.message}` }
  }
  rt.error = null
  log(task.id, 'INFO', `已启用调度: ${task.cron}，下次执行 ${rt.job.nextRun()?.toLocaleString('zh-CN') ?? '无'}`)
  return { ok: true }
}

export function unscheduleTask(taskId) {
  const rt = runtimes.get(taskId)
  if (!rt || !rt.job) return { ok: true, already: true }
  rt.job.stop()
  rt.job = null
  log(taskId, 'INFO', '已停用调度')
  return { ok: true }
}

/** 删除任务时清理运行时（停调度 + 杀进程） */
export async function disposeTask(taskId) {
  unscheduleTask(taskId)
  killRun(taskId)
  runtimes.delete(taskId)
}

/** 服务退出时停掉所有调度与子进程 */
export async function shutdown() {
  for (const [taskId] of runtimes) {
    unscheduleTask(taskId)
    killRun(taskId)
  }
}
