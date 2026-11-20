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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
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
}).listen(PORT, HOST, () => console.log(`serving ${root} at http://${HOST}:${PORT}${PREFIX}`));
