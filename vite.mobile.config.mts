import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('./src/renderer', import.meta.url))
const outDir = fileURLToPath(new URL('./dist-mobile', import.meta.url))

export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@platform': fileURLToPath(new URL('./src/platform', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url))
    }
  },
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url))
    }
  }
})
