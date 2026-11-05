import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: { alias: { '@': '/src' } },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    server: { deps: { inline: ['vuetify'] } },
  },
})
