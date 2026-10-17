import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
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
