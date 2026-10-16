import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite loads ESM configs natively, so `import.meta.dirname` (not __dirname)
// is the path reference that keeps working with the native config loader.
const rootDir = import.meta.dirname;

/**
 * Library build: powerboard/core, powerboard/react and powerboard/bridge.
 * React and friends stay external — the host (PowerScroll or the standalone
 * app) supplies them, so the package never bundles a second React copy.
 */
const externals = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  /^react\//,
  /^react-dom\//,
  'zustand',
  'lucide-react',
  'marked',
  'nanoid',
];

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        core: resolve(rootDir, 'src/core/index.ts'),
        react: resolve(rootDir, 'src/react/index.ts'),
        bridge: resolve(rootDir, 'src/bridge/index.ts'),
      },
      formats: ['es'],
      cssFileName: 'powerboard',
    },
    rollupOptions: {
      external: externals,
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts?(x)'],
  },
});
