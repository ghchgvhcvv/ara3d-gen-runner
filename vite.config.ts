import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Set BASE_PATH (e.g. /3d-gen/) when hosting under a sub-path, such as GitHub Pages.
  base: process.env.BASE_PATH ?? '/',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // Engine-side GLB check page (npm run test:gltf).
        gltfCheck: resolve(import.meta.dirname, 'gltf-check.html'),
      },
    },
  },
});
