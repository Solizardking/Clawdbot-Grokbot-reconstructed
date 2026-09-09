import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    setupFiles: ['./server/testing/setup.ts'],
    include: ['{src,server,shared,electron,scripts,companion}/**/*.test.{ts,tsx,mjs,cjs}'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
