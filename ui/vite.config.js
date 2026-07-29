import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// dev 时把 /api 反代到 task-scheduler server（默认 8021）
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: './',
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.TASK_SCHEDULER_API || 'http://localhost:8021',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
