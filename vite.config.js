import { defineConfig } from 'vite';

export default defineConfig({
  // supabase-js is imported lazily, so list it for dev pre-bundling.
  optimizeDeps: { noDiscovery: true, include: ['@supabase/supabase-js'] },
  build: {
    rollupOptions: {
      // Two pages share one game bundle: / (Korean) and /en/ (English); src/i18n.js reads <html lang>.
      input: { main: 'index.html', en: 'en/index.html' },
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
