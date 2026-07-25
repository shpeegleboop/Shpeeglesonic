import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the Tauri dev-server config stays
// untouched — these tests only cover pure modules, no JSX or plugins needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
