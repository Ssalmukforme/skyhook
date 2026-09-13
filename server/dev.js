// Local API for development without PostgreSQL installed: runs real Postgres SQL through PGlite
// and keeps data in ./.pglite. Production uses server/index.js with DATABASE_URL.
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from './app.js';
import { createStore } from './store.js';

const dataDir = process.env.PGLITE_DIR ?? new URL('../.pglite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const db = new PGlite(dataDir);
const store = createStore({ query: (text, params) => db.query(text, params), exec: text => db.exec(text) });
await store.migrate();
const port = Number(process.env.PORT ?? 8787);
http.createServer(createApp({ store })).listen(port, '127.0.0.1', () => console.log(`[skyhook] local leaderboard API on http://127.0.0.1:${port} (PGlite data: ${dataDir})`));
