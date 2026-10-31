// SHIVNEE relay — Node version (local development, or any VPS).
// The rules live in ./relay.ts and are shared with the Cloudflare version in ../cloudflare/worker.ts.
//
// Run: npm run server   (or npm start to also serve the built web app)

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { b64, randomBytes, randomId } from '../shared/encoding';
import type { ServerMsg } from '../shared/protocol';
import { handleFrame, MAX_FRAME_BYTES, type RelayConn, type RelayHub } from './relay';
import { Store } from './store';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE ?? join(ROOT, 'server', 'data', 'store.json');
const DIST = join(ROOT, 'dist');
const MAIL_TTL = 30 * 24 * 60 * 60 * 1000; // undelivered envelopes are dropped after 30 days

const store = new Store(DATA_FILE);
const online = new Map<string, RelayConn>();
const hub: RelayHub = {
  online: (h) => online.get(h),
  register: (h, c) => void online.set(h, c),
  unregister: (h, c) => {
    if (online.get(h)?.id === c.id) online.delete(h);
  },
};

/* --------------------------------------------------------- static files */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.json': 'application/json',
};

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...store.stats(), online: online.size }));
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('SHIVNEE relay is running. Start the web app with `npm run dev`, or run `npm run build` and reload to serve it from here.');
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  createReadStream(file).pipe(res);
});

/* ------------------------------------------------------------ websocket */

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_FRAME_BYTES + 64 * 1024 });

wss.on('connection', (ws) => {
  let tokens = 60; // simple rate limit: ~30 messages per second sustained
  const refill = setInterval(() => (tokens = Math.min(60, tokens + 30)), 1000);
  const c: RelayConn = {
    id: randomId(),
    nonce: b64(randomBytes(32)),
    handle: null,
    setHandle(h) {
      this.handle = h;
    },
    send: (m: ServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
    close: (code, reason) => ws.close(code, reason),
  };
  c.send({ t: 'challenge', nonce: c.nonce });

  ws.on('message', (raw) => {
    if (tokens-- <= 0) return c.send({ t: 'error', code: 'rate_limited' });
    handleFrame(store, hub, c, String(raw), console.log);
  });
  ws.on('close', () => {
    clearInterval(refill);
    if (c.handle) hub.unregister(c.handle, c);
  });
});

setInterval(() => {
  for (const ws of wss.clients) ws.ping();
}, 30_000);
setInterval(() => store.purge(MAIL_TTL), 60 * 60 * 1000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}

http.listen(PORT, HOST, () => {
  console.log(`SHIVNEE relay listening on http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
  console.log(existsSync(DIST) ? 'Serving the built web app from ./dist' : 'Web app not built — use `npm run dev` for the client.');
});
