import { defineConfig } from 'vite';

// The fighting game lives in game/ and is published next to the main app under /game/.
export default defineConfig({
  root: 'game',
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist/game',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 100_000,
    cssCodeSplit: false,
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
  server: { port: 5174, host: true },
});
