import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'browser-mcp-adapter',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
