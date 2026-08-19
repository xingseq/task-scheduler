# task-scheduler

XingSeq 子应用：定时执行命令，带 Web GUI。

## 功能

- **cron 调度**：基于 [croner](https://github.com/hexagon/croner) 解析标准 5 段 cron 表达式（秒级 6 段亦支持），到点自动执行命令
- **命令执行**：通过 `/bin/sh -c` 执行，支持管道、重定向等 shell 语法；可指定工作目录与超时时间
- **并发保护**：同一任务上次未执行完时跳过本次触发；超时先 SIGTERM、2s 后 SIGKILL 整个进程组
- **执行历史**：每次执行记录状态（成功/失败/超时/中断）、耗时、退出码与输出尾部，落盘持久化
- **实时日志**：每任务内存环形缓冲 + SSE 日志流
- **Web GUI**：任务列表（按命令分组，组内按下次执行时间正序；启停/立即执行/终止）、新建/编辑任务表单（cron 快捷模板）、执行历史（按任务筛选、展开看输出）

## 目录结构

```
src/
  server.mjs            # HTTP server — API 路由 + SSE + 静态托管
  task-store.mjs        # 任务持久化（~/.xingseq/task-scheduler/tasks.json）
  scheduler-engine.mjs  # 调度引擎 — croner + spawn + 历史（history.json）
ui/                     # Vite + React + Tailwind 前端
```

## 使用

```bash
npm install
npm run build      # 构建前端到 ui/dist
npm start          # 启动服务，默认 http://localhost:8021
```

开发模式（前端热更新，/api 反代到 8021）：

```bash
npm start          # 终端 1：后端
npm run dev        # 终端 2：前端 dev server (5180)
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/tasks` | 任务列表 / 新建任务 |
| GET/PUT/DELETE | `/api/tasks/:id` | 任务详情 / 更新 / 删除 |
| POST | `/api/tasks/:id/enable` `disable` | 启停调度 |
| POST | `/api/tasks/:id/run` `kill` | 手动执行 / 终止执行 |
| GET | `/api/tasks/:id/logs[/stream]` | 日志（SSE 流） |
| GET/DELETE | `/api/history?taskId=&limit=` | 执行历史查询 / 清空 |

## 数据

任务与执行历史落盘于 `~/.xingseq/task-scheduler/`（`tasks.json` / `history.json`）。

## 注意

- 调度依赖本服务进程常驻；服务停止期间错过的触发不会补跑
- 服务异常退出时未完成的执行记录会在下次启动时标记为「中断」
