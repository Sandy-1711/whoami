import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// The server runs Vite in middleware mode rather than as a second process, so
// this config is loaded by src/server/main.ts, not by a `vite` CLI invocation.
export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwind()],
});
