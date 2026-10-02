import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node, without the Cloudflare plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
