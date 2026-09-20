import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
