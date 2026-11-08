#!/usr/bin/env node
// Serves a folder under a sub-path, the way GitHub Pages does (/More-co./paewai/).
//   node scripts/serve.mjs [dir=dist] [--port=4173] [--base=/More-co./paewai/]

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const port = Number(args.find((a) => a.startsWith('--port='))?.slice(7) ?? 4173);
const base = args.find((a) => a.startsWith('--base='))?.slice(7) ?? '/More-co./paewai/';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(base)) {
    res.writeHead(302, { location: base }).end();
    return;
  }
  let file = normalize(join(dir, path.slice(base.length)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`http://localhost:${port}${base}`));
