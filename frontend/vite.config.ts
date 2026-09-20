import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The backend may auto-switch ports when 3001 is occupied; it records the
// actual port in backend/.dev-port. Fall back to PORT env / 3001.
function backendTarget(): string {
  let port = Number(process.env.BACKEND_PORT ?? 3001);
  try {
    const raw = readFileSync(resolve(__dirname, '../backend/.dev-port'), 'utf8').trim();
    const p = Number(raw);
    if (p > 0) port = p;
  } catch {
    // backend not running yet / file absent
  }
  // 127.0.0.1 (not "localhost") avoids IPv6/IPv4 mismatches on dual-stack
  // machines where localhost resolves to ::1 first.
  return `http://127.0.0.1:${port}`;
}

// If the backend's preferred port is busy it starts on the next free one;
// point the dev proxy at it with VITE_BACKEND_URL=http://localhost:3002
const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          realtime: ['socket.io-client'],
          markdown: ['markdown-it', 'dompurify', 'highlight.js'],
        },
      },
    },
  },
  server: {
    // strictPort: false (default) — if 5173 is taken Vite picks the next
    // free port automatically and prints the actual URL.
    port: 5173,
    // Re-evaluated per request, so a backend port change needs no frontend
    // restart and no static string target.
    proxy: {
      '/api': backendUrl,
      '/uploads': backendUrl,
      '/socket.io': {
        target: backendUrl,
        ws: true,
      },
    },
  },
});
