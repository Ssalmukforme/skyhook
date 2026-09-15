import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Two builds from one codebase:
//   npm run build              -> dist/            own site: / (Korean) and /en/ (English), Adsterra banners, Google Fonts
//   npm run build:crazygames   -> dist-crazygames/ CrazyGames portal: one English page, CrazyGames SDK, fonts bundled, relative paths
const FONT_IMPORTS = [
  '@fontsource/noto-sans-kr/latin-400.css', '@fontsource/noto-sans-kr/latin-500.css', '@fontsource/noto-sans-kr/latin-600.css',
  '@fontsource/noto-sans-kr/latin-700.css', '@fontsource/noto-sans-kr/latin-800.css',
  '@fontsource/barlow-condensed/latin-500.css', '@fontsource/barlow-condensed/latin-600.css', '@fontsource/barlow-condensed/latin-800.css',
].map(file => `import '${file}';`).join('\n');

// The portal page is the English page without anything aimed at the own site: no search/share tags, no icons or
// absolute links, no language switch (it points outside the portal), plus the CrazyGames SDK script.
function portalPage(html) {
  return html
    .replace(/<title>[^<]*<\/title>/, '<title>SKYHOOK</title>')
    .replace(/<link rel="(canonical|alternate|icon|apple-touch-icon|manifest)"[^>]*>\n?/g, '')
    .replace(/<meta (property|name)="(og:[^"]*|twitter:[^"]*|google-site-verification|description)"[^>]*>\n?/g, '')
    .replace(/<script type="application\/ld\+json">.*?<\/script>\n?/s, '')
    .replace(/<a class="lang-link"[^>]*>.*?<\/a>/, '')
    .replace('</head>', '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n</head>');
}

function platformBuild(crazygames) {
  const fontsId = 'virtual:skyhook-fonts', resolvedFonts = '\0' + fontsId;
  return {
    name: 'skyhook-platform',
    resolveId: id => (id === fontsId ? resolvedFonts : null),
    // Portal builds carry their fonts; the own site keeps loading them from Google Fonts.
    load: id => (id === resolvedFonts ? (crazygames ? FONT_IMPORTS : '') : null),
    transform(code, id) {
      if (crazygames && id.split('?')[0].endsWith('/src/style.css')) return code.replace(/@import url\([^)]*fonts\.googleapis[^)]*\);/, '');
    },
    transformIndexHtml: { order: 'pre', handler: html => (crazygames ? portalPage(readFileSync('en/index.html', 'utf8')) : html) },
  };
}

export default defineConfig(({ mode }) => {
  const crazygames = mode === 'crazygames';
  return {
    base: crazygames ? './' : '/',
    publicDir: crazygames ? false : 'public',
    define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify(crazygames ? 'crazygames' : 'web') },
    plugins: [platformBuild(crazygames)],
    // supabase-js is imported lazily, so list it for dev pre-bundling.
    optimizeDeps: { noDiscovery: true, include: ['@supabase/supabase-js'] },
    build: {
      outDir: crazygames ? 'dist-crazygames' : 'dist',
      rollupOptions: {
        // Own site: / and /en/ share one game bundle; src/i18n.js reads <html lang>. Portal: a single English page.
        input: crazygames ? { main: 'index.html' } : { main: 'index.html', en: 'en/index.html' },
        output: { manualChunks: { three: ['three'] } },
      },
    },
  };
});
