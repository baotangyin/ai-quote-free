import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['out/**', 'dist/**', 'node_modules/**'],
    pool: 'forks'
  }
});
