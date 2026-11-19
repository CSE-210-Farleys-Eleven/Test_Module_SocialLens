import { defineConfig } from 'vitest/config';

// AT Protocol OAuth loopback clients must be served from a loopback IP
// (http://127.0.0.1:<port>), never from the hostname "localhost".
// The port is fixed so the redirect URI in the loopback client_id is stable.
export const DEV_HOST = '127.0.0.1';
export const DEV_PORT = 5173;

export default defineConfig({
  server: { host: DEV_HOST, port: DEV_PORT, strictPort: true },
  preview: { host: DEV_HOST, port: DEV_PORT, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
