import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
  },
  define: {
    // Mock cloudflare workers globals for testing
    'globalThis.DurableObject': 'undefined',
    'globalThis.SqlStorage': 'undefined',
  },
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./mocks/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
});