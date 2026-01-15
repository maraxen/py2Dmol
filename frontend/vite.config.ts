import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: '../py2Dmol/resources',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/viewer-mol.ts'),
      name: 'py2dmol_mol',
      formats: ['iife'],
      fileName: () => 'viewer-mol.bundle.js'
    },
    rollupOptions: {
      output: {
        extend: true,
      }
    },
    minify: true
  }
});
