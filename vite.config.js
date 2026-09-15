import { defineConfig } from 'vite';

export default defineConfig({
  // supabase-js is imported lazily, so list it for dev pre-bundling.
  optimizeDeps: { noDiscovery: true, include: ['@supabase/supabase-js'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
