// 从 vitest/config 导入 defineConfig，它的类型里才有 test 字段
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  test: {
    // 测试文件放在 client 下，但被测代码在 shared/：
    // client 是全项目唯一装了测试运行器的地方，
    // 为 shared/ 单独建一套 package.json + node_modules 不值得。
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
