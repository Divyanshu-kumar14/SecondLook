import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plan D6: the client build must NOT run inside `npm start` (it would blow the
// 8s cold-start budget). It runs during `npm install` via the `prepare` script.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});