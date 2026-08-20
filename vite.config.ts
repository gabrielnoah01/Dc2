import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    /**
     * Arquivo pequeno o bastante vira `data:` embutido, e é exatamente o que
     * não pode acontecer com o processador do AudioWorklet: o CSP do app é
     * `default-src 'self'`, que não aceita script vindo de `data:`. Ele
     * precisa sair como arquivo de verdade, servido pela própria origem.
     */
    assetsInlineLimit: (filePath) => (filePath.includes('.worklet.') ? false : undefined),
  },
});
