/**
 * server.mjs
 * task-scheduler HTTP server — API 路由 + SSE 日志流 + 静态文件（ui/dist）
 *
 * 端口：PORT 环境变量（electron-shell 按 manifest portEnv 注入），默认 8021
 */

import http from 'node:http'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as store from './task-store.mjs'
import * as engine from './scheduler-engine.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_DIST = path.resolve(__dirname, '..', 'ui', 'dist')
const PORT = parseInt(process.env.PORT || '8021', 10)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', c => {
      raw += c
      if (raw.length > 1_000_000) { req.destroy(); reject(new Error('body 过大')) }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('无效 JSON')) }
    })
    req.on('error', reject)
  })
}

/** 任务 + 运行状态组装 */
function withStatus(task) {
  return { ...task, ...engine.getStatus(task.id) }
}

// ── API 路由 ──────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'tasks', ':id', ...]
  const method = req.method

  // GET /api/health
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: 'task-scheduler' })
  }

  // /api/history 全局执行历史
  if (parts[1] === 'history' && parts.length === 2) {
    if (method === 'GET') {
      const taskId = url.searchParams.get('taskId') || undefined
      const limit = parseInt(url.searchParams.get('limit') || '100', 10)
      const records = await engine.getHistory({ taskId, limit })
      return sendJson(res, 200, { records })
    }
    if (method === 'DELETE') {
      const taskId = url.searchParams.get('taskId') || undefined
      await engine.clearHistory(taskId)
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  // /api/tasks 集合
  if (parts[1] === 'tasks' && parts.length === 2) {
    if (method === 'GET') {
      const tasks = await store.listTasks()
      return sendJson(res, 200, { tasks: tasks.map(withStatus) })
    }
    if (method === 'POST') {
      const body = await readBody(req)
      const invalid = store.validateTask(body)
      if (invalid) return sendJson(res, 400, { error: invalid })
      const task = await store.createTask(body)
      if (task.enabled) engine.scheduleTask(task)
      return sendJson(res, 201, { task: withStatus(task) })
    }
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  // /api/tasks/:id[...]
  if (parts[1] === 'tasks' && parts.length >= 3) {
    const id = parts[2]
    const task = await store.getTask(id)
    if (!task) return sendJson(res, 404, { error: '任务不存在' })
    const action = parts[3]

    if (!action) {
      if (method === 'PUT') {
        const body = await readBody(req)
        const merged = { ...task, ...body }
        const invalid = store.validateTask(merged)
        if (invalid) return sendJson(res, 400, { error: invalid })
        // cron/command 变更需重建调度，直接先停
        engine.unscheduleTask(id)
        const updated = await store.updateTask(id, body)
        if (updated.enabled) engine.scheduleTask(updated)
        return sendJson(res, 200, { task: withStatus(updated) })
      }
      if (method === 'DELETE') {
        await engine.disposeTask(id)
        await store.deleteTask(id)
        return sendJson(res, 200, { ok: true })
      }
      if (method === 'GET') return sendJson(res, 200, { task: withStatus(task) })
      return sendJson(res, 405, { error: 'method not allowed' })
    }

    if (action === 'enable' && method === 'POST') {
      const updated = await store.updateTask(id, { enabled: true })
      const result = engine.scheduleTask(updated)
      return sendJson(res, result.ok ? 200 : 400, { ...result, task: withStatus(updated) })
    }
    if (action === 'disable' && method === 'POST') {
      const updated = await store.updateTask(id, { enabled: false })
      const result = engine.unscheduleTask(id)
      return sendJson(res, 200, { ...result, task: withStatus(updated) })
    }
    if (action === 'run' && method === 'POST') {
      // 手动触发不阻塞响应，结果通过历史/日志查看
      engine.runTask(task, 'manual').catch(() => {})
      return sendJson(res, 200, { ok: true, task: withStatus(task) })
    }
    if (action === 'kill' && method === 'POST') {
      const result = engine.killRun(id)
      return sendJson(res, 200, { ...result, task: withStatus(task) })
    }
    if (action === 'logs' && method === 'GET') {
      if (parts[4] === 'stream') {
        // SSE 实时日志流
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        })
        res.write(': connected\n\n')
        const unsubscribe = engine.subscribeLogs(id, (entry) => {
          res.write(`data: ${JSON.stringify(entry)}\n\n`)
        })
        const keepalive = setInterval(() => { res.write(': ping\n\n') }, 25_000)
        req.on('close', () => { clearInterval(keepalive); unsubscribe() })
        return
      }
      const limit = parseInt(url.searchParams.get('limit') || '200', 10)
      return sendJson(res, 200, { logs: engine.getLogs(id, limit) })
    }
    if (action === 'history' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10)
      const records = await engine.getHistory({ taskId: id, limit })
      return sendJson(res, 200, { records })
    }
    return sendJson(res, 404, { error: 'unknown action' })
  }

  return sendJson(res, 404, { error: 'not found' })
}

// ── 静态文件 ──────────────────────────────────────────────────────────────────

async function handleStatic(res, pathname) {
  let filePath = path.join(UI_DIST, pathname === '/' ? 'index.html' : pathname)
  // 防目录穿越
  if (!filePath.startsWith(UI_DIST)) {
    res.writeHead(403); return res.end('forbidden')
  }
  try {
    let data = await fs.readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    // SPA 兜底到 index.html
    try {
      const html = await fs.readFile(path.join(UI_DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': MIME['.html'] })
      res.end(html)
    } catch {
      res.writeHead(404)
      res.end('ui/dist 未构建，请先运行 npm run build')
    }
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
    } else {
      await handleStatic(res, url.pathname)
    }
  } catch (err) {
    console.error(`[task-scheduler] 请求处理异常: ${err.message}`)
    if (!res.headersSent) sendJson(res, 500, { error: err.message })
  }
})

server.listen(PORT, async () => {
  console.log(`[task-scheduler] server 就绪: http://localhost:${PORT}`)
  // 自动调度所有启用的任务
  const tasks = await store.listTasks()
  for (const task of tasks) {
    if (task.enabled) {
      const result = engine.scheduleTask(task)
      if (!result.ok) console.warn(`[task-scheduler] 调度 ${task.label} 失败: ${result.error}`)
    }
  }
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await engine.shutdown()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
