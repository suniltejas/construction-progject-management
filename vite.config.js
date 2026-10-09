import { defineConfig } from 'vite';

export default defineConfig({
  base: '/projects/',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/projects/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
