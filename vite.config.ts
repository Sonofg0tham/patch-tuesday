import { defineConfig } from 'vite';

// Honour a PORT from the environment (used by preview tooling), fall back to
// the Vite default. strictPort stays off so a busy port never blocks dev.
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
