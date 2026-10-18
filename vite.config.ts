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
    // The client calls `/mcp` on its OWN origin (`new URL('/mcp', location.origin)`).
    // In dev that origin is :5173, so without a proxy every tool call would hit
    // Vite and 404. Forward it to the MCP server — which is also why :5173 is in
    // the server's `allowedOrigins` (plan decision D5).
    proxy: {
      '/mcp': {
        target: `http://127.0.0.1:${process.env.PORT ?? 8787}`,
        // Rewrite Host to the MCP server's own address. Without this the
        // request arrives carrying `Host: localhost:5173`, which the server's
        // DNS-rebinding defence correctly rejects with a 403 — the same
        // defence that protects the production path.
        changeOrigin: true,
      },
    },
  },
});