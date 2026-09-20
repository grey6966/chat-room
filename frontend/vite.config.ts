import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Explicit override always wins (e.g. VITE_BACKEND_URL=http://localhost:3002).
const envBackend = process.env.VITE_BACKEND_URL;
const devPortFile = resolve(__dirname, '../backend/.dev-port');

/**
 * Resolve the backend target at config load. When the backend's preferred
 * port is busy it starts on the next free one and publishes that port to
 * backend/.dev-port, so a frontend started afterwards finds it with no flag.
 * 127.0.0.1 (not "localhost") avoids IPv6/IPv4 mismatches on dual-stack
 * machines where localhost resolves to ::1 first.
 */
function backendTarget(): string {
  if (envBackend) return envBackend;
  try {
    const raw = readFileSync(devPortFile, 'utf8').trim();
    const port = Number(raw);
    if (port > 0) return `http://127.0.0.1:${port}`;
  } catch {
    // backend not running yet / file absent
  }
  return 'http://127.0.0.1:3001';
}

/**
 * Vite 6's bundled http-proxy uses a static target captured at startup (it has
 * no per-request `router`), so watch the backend's published port file and
 * restart the dev server when the backend drifts to another port. Restart is
 * automatic and brief; socket.io reconnects on its own.
 */
function followBackendPort(): PluginOption {
  return {
    name: 'chat:follow-backend-port',
    apply: 'serve',
    configureServer(server) {
      if (envBackend) return; // explicit target: never auto-restart
      let restarting = false;
      const onChange = (file: string): void => {
        if (resolve(file) !== devPortFile || restarting) return;
        restarting = true;
        server.config.logger.info('[vite] backend port changed, restarting proxy…');
        void server.restart().finally(() => {
          restarting = false;
        });
      };
      server.watcher.add(devPortFile);
      server.watcher.on('add', onChange);
      server.watcher.on('change', onChange);
    },
  };
}

export default defineConfig({
  plugins: [react(), followBackendPort()],
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
    proxy: {
      '/api': backendTarget(),
      '/uploads': backendTarget(),
      '/socket.io': {
        target: backendTarget(),
        ws: true,
      },
    },
  },
});
