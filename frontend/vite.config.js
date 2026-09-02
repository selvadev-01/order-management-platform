import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api to the gateway so the browser sees one origin in development
    // and CORS never enters the picture locally.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  /**
   * `npm start` — serves the built app from dist/.
   *
   * For hosts that run a command rather than serving static files (Railway,
   * Fly, a container). On a static host such as the Render static site in
   * render.yaml, dist/ is served directly and this is never used.
   *
   * PORT is read here because Vite honours it for `dev` but not for `preview`,
   * and a host assigns the port rather than letting the app choose. 0.0.0.0
   * because a loopback-only bind is unreachable from outside a container.
   */
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: '0.0.0.0',
  },
});
