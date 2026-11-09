// Permafrost server: serves the game page and runs the shared world over WebSocket.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { ClientMsg } from '../src/net/protocol';
import { Store } from './db';
import { Client, Game } from './game';

declare const __APP_VERSION__: string;

const PORT = Number(process.env.PORT ?? 8791);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? 'dist');
const DB_FILE = process.env.DB_FILE ?? 'data/permafrost.db';
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const IP_HEADER = (process.env.CLIENT_IP_HEADER ?? '').toLowerCase();
const MAX_PER_IP = 6;
const MAX_ONLINE = Number(process.env.MAX_ONLINE ?? 60);

const store = new Store(DB_FILE);
const game = new Game(store);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, '.' + rel);
  if (!file.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const hashed = rel.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, version: __APP_VERSION__, online: game.online, season: game.season }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

const perIp = new Map<string, number>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function clientIp(req: http.IncomingMessage): string {
  const h = IP_HEADER ? req.headers[IP_HEADER] : undefined;
  const v = Array.isArray(h) ? h[0] : h;
  return (v?.split(',')[0].trim() || req.socket.remoteAddress) ?? '?';
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const origin = req.headers.origin ?? '';
  const ip = clientIp(req);
  if (url.pathname !== '/ws' || (ALLOWED.length && !ALLOWED.includes(origin)) || (perIp.get(ip) ?? 0) >= MAX_PER_IP || game.online >= MAX_ONLINE) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const c = new Client({ send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) }, ip);
    // Token bucket: inputs arrive about 30 times a second; floods get cut off.
    let tokens = 120;
    let last = Date.now();
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on('message', (data) => {
      const now = Date.now();
      tokens = Math.min(120, tokens + ((now - last) / 1000) * 60);
      last = now;
      if (--tokens < 0) {
        ws.close(1008, 'Too many messages');
        return;
      }
      let m: ClientMsg;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      try {
        game.handle(c, m);
      } catch (e) {
        console.error('handler error', e);
      }
    });
    ws.on('close', () => {
      clearInterval(ping);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      game.drop(c);
    });
  });
});

// Fixed 60 Hz simulation, catching up after a slow moment but never spiralling.
const TICK = 1000 / 60;
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= TICK && n < 8) {
    try {
      game.tick();
    } catch (e) {
      console.error('tick error', e);
    }
    acc -= TICK;
    n++;
  }
  if (acc > 250) acc = 0;
}, 4);

server.listen(PORT, () => {
  console.log(`Permafrost v${__APP_VERSION__} on :${PORT}, static from ${STATIC_DIR}, season ${game.season}, ${store.count()} accounts`);
});

const shutdown = () => {
  game.save();
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
