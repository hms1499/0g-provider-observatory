import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dashboard is a static page. It reads 0G Chain and 0G Storage directly from the
 * browser; the one server-side thing on this deployment is the measurement relay at
 * `/api/router`, which is a Vercel Function and not something Vite serves.
 */
export default defineConfig({
  plugins: [react()],
  root: 'dashboard',
  build: { outDir: '../dashboard-dist', emptyOutDir: true },
  server: {
    /**
     * Under `vercel dev`, HMR gets its own port instead of riding the page's origin. This
     * is a workaround for a CLI bug, not a preference. Measured on CLI 54.21.0 and 59.5.0,
     * both the same: once an `api/` function exists, `vercel dev` runs a second builder dev
     * server for it, and it proxies the browser's websocket upgrade to that one instead of
     * to Vite —
     *
     *     Detected "upgrade" event, proxying to builder dev server at http://127.0.0.1:57130
     *     Error: An unexpected error occurred!
     *     Error: read ECONNRESET
     *
     * — where Vite was on 57054. The Node builder's dev server is not a websocket server, it
     * resets the socket, and nothing in the CLI handles that, so the dev server dies the
     * moment a browser opens the page. `server.hmr: false` does not help: Vite 8 still injects
     * its client and the client still opens the socket. Giving HMR a port of its own means the
     * browser connects straight to Vite and the upgrade never reaches the proxy.
     *
     * `pnpm dashboard:dev` is unaffected: `VERCEL` is set only by the CLI.
     */
    hmr: process.env.VERCEL === '1' ? { port: 24678 } : true,
  },
});
