const { build } = require('vite');
const { resolve } = require('path');

const entries = [
  { name: 'viewer-mol', path: 'src/viewer-mol.ts', global: 'py2dmol_mol' },
  { name: 'viewer-pae', path: 'src/viewer-pae.ts', global: 'py2dmol_pae' },
  { name: 'viewer-scatter', path: 'src/viewer-scatter.ts', global: 'py2dmol_scatter' },
  { name: 'viewer-msa', path: 'src/viewer-msa.ts', global: 'py2dmol_msa' },
  { name: 'viewer-seq', path: 'src/viewer-seq.ts', global: 'py2dmol_seq' }
];

async function runBuilds() {
  for (const entry of entries) {
    console.log(`Building ${entry.name}...`);
    await build({
      configFile: false,
      build: {
        outDir: '../py2Dmol/resources',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, entry.path),
          name: entry.global,
          formats: ['iife'],
          fileName: () => `${entry.name}.bundle.js`
        },
        rollupOptions: {
          output: {
            extend: true,
          }
        },
        minify: true
      }
    });
  }
}

runBuilds();
