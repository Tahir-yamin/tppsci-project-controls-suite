import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the same build works at a domain root (Vercel) and
  // under a sub-path (a RunPod proxy URL), with no rebuild in between.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
