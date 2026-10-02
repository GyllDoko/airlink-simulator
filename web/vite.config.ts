import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    // Le code partagé (../src/shared) est hors de la racine Vite.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
