import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

// base 用相对路径，Wails 从本地文件加载 dist。
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  build: { outDir: loadEnv(mode, '.', 'VITE_').VITE_DEMO === 'true' ? 'dist-demo' : 'dist' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: { environment: 'node' },
}))
