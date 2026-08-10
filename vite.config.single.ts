import { defineConfig } from 'vite';

/**
 * Single-file preview build.
 *
 * `npm run build:single` emits `dist-single/` with the whole app in one JS
 * bundle and one stylesheet, which can then be inlined into a single HTML file
 * for hosts that will only serve one self-contained page (a shared preview
 * link, an email attachment, an offline copy on a site with no web access).
 *
 * This is NOT the deployment build. It disables code splitting, so jsPDF is
 * pulled into the main bundle instead of being fetched on demand — roughly
 * three times the initial download. Vercel and the RunPod container both use
 * the normal `npm run build`.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-single',
    target: 'es2022',
    cssCodeSplit: false,
    // Inline every asset so nothing is left referencing a sibling file.
    assetsInlineLimit: 100_000_000,
    // One bundle beats the warning about it being large; that is the point here.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
