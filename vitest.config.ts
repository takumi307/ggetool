import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Vitest は Vite 本体とは独立した設定で起動し、プラグイン型の混在を防ぐ。
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    server: { deps: { inline: ['vuetify'] } },
  },
})
