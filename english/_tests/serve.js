#!/usr/bin/env node
/* Minimal static server for tests: serves ../../_site under the
   GitHub Pages prefix /latent-frontiers/ so relative paths are checked
   exactly as they will be in production. */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '_site');
const PREFIX = '/latent-frontiers/';
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.ico': 'image/x-icon', '.gif': 'image/gif', '.mp4': 'video/mp4' };

/* Opt-in local account configuration (EFL_LOCAL_CONFIG=1): serves
   english/_local/config.js in place of app/config.js. That folder is
   git-ignored and starts with "_", so Quarto never copies or publishes it;
   the committed config.js stays empty (guest mode). Never used by tests. */
const LOCAL_CONFIG = process.env.EFL_LOCAL_CONFIG === '1'
  ? join(dirname(fileURLToPath(import.meta.url)), '..', '_local', 'config.js') : null;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (LOCAL_CONFIG && url.pathname === `${PREFIX}english/app/config.js`) {
    try {
      const body = await readFile(LOCAL_CONFIG);
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    } catch { /* no local file: fall through to the empty committed config */ }
  }
  if (url.pathname === '/latent-frontiers') { res.writeHead(301, { Location: PREFIX }); res.end(); return; }
  if (!url.pathname.startsWith(PREFIX)) { res.writeHead(404); res.end('not under prefix'); return; }
  let p = normalize(decodeURIComponent(url.pathname.slice(PREFIX.length)));
  if (p.startsWith('..')) { res.writeHead(403); res.end(); return; }
  let file = join(root, p);
  try {
    const s = await stat(file);
    if (s.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: `${url.pathname}/` }); res.end(); return; }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, HOST, () => console.log(`serving ${root} at http://${HOST}:${PORT}${PREFIX}${LOCAL_CONFIG ? ' (local account config: english/_local/config.js)' : ''}`));
