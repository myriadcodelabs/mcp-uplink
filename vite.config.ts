import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve(import.meta.dirname, 'ui'), build: { outDir: resolve(import.meta.dirname, 'ui-dist'), emptyOutDir: true } });
