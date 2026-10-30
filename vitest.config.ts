import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests never start the IWSDK dev runtime.
// Only pure modules (sculpt, blocks, persistence model, agent repair) are tested here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
});
