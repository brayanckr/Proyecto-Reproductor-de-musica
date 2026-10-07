import { defineConfig } from 'vite';

/**
 * Vite configuration for the UCCplay web client.
 *
 * The core library still builds to `dist/` via `tsc -p tsconfig.core.json`,
 * while the web application is bundled to `dist-web/` to avoid collisions.
 */
export default defineConfig({
    build: {
        outDir: 'dist-web',
        emptyOutDir: true
    },
    server: {
        port: 5173,
        open: true
    }
});
