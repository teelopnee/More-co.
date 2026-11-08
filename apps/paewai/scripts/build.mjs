#!/usr/bin/env node
// Copies src/ to dist/ and stamps the service worker with the file list and a content hash,
// so every change ships as a new offline cache. No dependencies.
//
//   node scripts/build.mjs [--out=dist]

import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = resolve(root, process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'dist');

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const files = walk(out)
  .map((f) => relative(out, f).split('\\').join('/'))
  .filter((f) => f !== 'sw.js')
  .sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest('hex').slice(0, 10);

function stamp(file, replacements) {
  const path = join(out, file);
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${file}: "${from}" not found`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
}

stamp('sw.js', [
  ["const VERSION = 'dev';", `const VERSION = '${version}';`],
  ["const FILES = ['./'];", `const FILES = ${JSON.stringify(['./', ...files])};`],
]);
stamp('app.js', [["const VERSION = 'dev';", `const VERSION = '${version}';`]]);

for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
  if (!existsSync(join(out, icon))) throw new Error(`missing ${icon} (npm run icons)`);
}
console.log(`แปะไว้ ${version}: ${files.length + 1} files → ${relative(process.cwd(), out) || '.'}`);
