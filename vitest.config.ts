import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@sdk': fileURLToPath(new URL('./sdk', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/plugins/**/*.test.ts']
  }
})
