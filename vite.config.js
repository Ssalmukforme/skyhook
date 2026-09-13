import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { noDiscovery: true, include: [] },
  // `npm run dev` forwards ranking calls to `npm start` or `npm run server:local`.
  server: { proxy: { '/api': process.env.SKYHOOK_API ?? 'http://127.0.0.1:8787' } },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
