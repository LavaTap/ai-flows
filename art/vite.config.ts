import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 产物由平台服务在 /art/ 路径下托管（platform.ts 扫描 web/art 生成白名单）
  base: '/art/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5188,
    strictPort: false,
    open: false,
    // 本地开发时把平台接口转发到 4311，复用平台登录会话
    proxy: {
      '/api': 'http://127.0.0.1:4311',
      '/login': 'http://127.0.0.1:4311',
    },
  },
  build: {
    target: 'es2020',
    outDir: '../web/art',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
})
