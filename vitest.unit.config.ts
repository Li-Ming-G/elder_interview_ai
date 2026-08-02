import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@elder-interview/config': fileURLToPath(
        new URL('./packages/config/src/index.ts', import.meta.url),
      ),
      '@elder-interview/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@elder-interview/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      exclude: ['**/dist/**', '**/generated/**', '**/*.config.*'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    environment: 'node',
    include: ['apps/**/*.spec.{ts,tsx}', 'packages/**/*.spec.{ts,tsx}'],
    passWithNoTests: false,
  },
});
