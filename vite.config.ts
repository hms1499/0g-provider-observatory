import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dashboard is a static page with no backend. It reads 0G Chain and 0G Storage
 * directly from the browser, so there is nothing to proxy and no server to configure.
 */
export default defineConfig({
  plugins: [react()],
  root: 'dashboard',
  build: { outDir: '../dashboard-dist', emptyOutDir: true },
});
