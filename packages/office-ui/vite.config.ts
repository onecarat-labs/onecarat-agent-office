import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local only: the dev/preview servers bind to 127.0.0.1.
export default defineConfig({
  plugins: [react()],
  // In dev, API/SSE calls go to a running bridge (npm run bridge). changeOrigin keeps the bridge Host check satisfied.
  server: {
    host: '127.0.0.1',
    port: 5317,
    strictPort: true,
    // The bridge must be started with --dev-origin http://127.0.0.1:5317 for the terminal WebSocket (exact Origin check).
    proxy: {
      '/api': { target: 'http://127.0.0.1:47821', changeOrigin: true },
      '/events': { target: 'http://127.0.0.1:47821', changeOrigin: true },
      '/pty': { target: 'ws://127.0.0.1:47821', ws: true, changeOrigin: true },
    },
  },
  preview: { host: '127.0.0.1', port: 5318, strictPort: true },
  // xterm.js makes the single bundle ~620 kB; it is served from localhost only.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
