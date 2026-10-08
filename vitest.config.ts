import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    // Every file starts from the shell environment, never the untracked .env
    // Prisma would otherwise load — see the file for why.
    setupFiles: ['tests/setup/test-environment.ts'],
    globals: true,
    reporters: ['default'],
  },
});
