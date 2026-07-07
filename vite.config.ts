import { defineConfig } from 'vite';

// Honour a PORT from the environment (used by preview tooling), fall back to
// the Vite default. strictPort stays off so a busy port never blocks dev.
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    // Three.js alone is ~517kB minified (131kB gzipped), which trips the
    // default 500kB warning. Expected for a 3D game, so raise the bar
    // rather than silence warnings we would want to hear about.
    chunkSizeWarningLimit: 600,
  },
});
