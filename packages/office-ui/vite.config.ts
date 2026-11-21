import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The page is built into dist/ and embedded in the app (src-tauri). Relative paths: it is not served from a web root.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5317, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
