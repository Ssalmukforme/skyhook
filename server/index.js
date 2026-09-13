import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { createStore } from './store.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('[skyhook] DATABASE_URL이 설정되지 않았습니다. .env.example을 복사해 .env를 만들어 주세요.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: Number(env.PG_POOL_MAX ?? 10), ssl: env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined });
pool.on('error', error => console.error('[skyhook] idle database client error:', error.message));
const store = createStore({ query: (text, params) => pool.query(text, params), exec: text => pool.query(text) });
try {
  await store.migrate();
} catch (error) {
  console.error(`[skyhook] PostgreSQL 연결 또는 테이블 생성 실패: ${error.message}`);
  console.error('[skyhook] DATABASE_URL의 호스트·포트·계정·DB 이름과 권한(CREATE TABLE)을 확인해 주세요.');
  await pool.end().catch(() => {});
  process.exit(1);
}

const defaultDist = fileURLToPath(new URL('../dist', import.meta.url));
const staticDir = env.STATIC_DIR === 'off' ? null : env.STATIC_DIR || (existsSync(defaultDist) ? defaultDist : null);
const app = createApp({ store, staticDir, corsOrigin: env.CORS_ORIGIN || null, trustProxy: env.TRUST_PROXY === 'true' });
const port = Number(env.PORT ?? 8787), host = env.HOST ?? '0.0.0.0';
const server = http.createServer(app).listen(port, host, () => {
  console.log(`[skyhook] http://${host}:${port}  (API /api, ${staticDir ? 'serving ' + staticDir : 'API only — run `npm run build` to serve the game'})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 5000).unref(); });
