import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node, without the Cloudflare plugin. Screen tests
// (*.test.tsx) ask for a browser-like DOM with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'worker/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      include: ['shared/**', 'worker/**', 'src/**'],
      exclude: ['**/*.test.{ts,tsx}', 'src/main.tsx', 'src/**/types.ts'],
    },
  },
})
