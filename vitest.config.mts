import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const rendererDir = fileURLToPath(new URL('./src/renderer/src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': sharedDir,
      '@renderer': rendererDir
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false
  }
})
