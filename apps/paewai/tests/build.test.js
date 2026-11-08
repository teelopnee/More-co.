import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build output works from a sub-path and works offline', () => {
  const out = mkdtempSync(join(tmpdir(), 'paewai-'));
  try {
    const r = spawnSync(process.execPath, ['scripts/build.mjs', `--out=${out}`], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);

    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport"/);
    const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 5);
    for (const ref of refs) {
      assert.ok(!ref.startsWith('/') && !/^https?:/.test(ref), `absolute URL in index.html: ${ref}`);
      assert.ok(existsSync(join(out, ref)), `missing ${ref}`);
    }

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) assert.ok(existsSync(join(out, icon.src)), icon.src);
    for (const s of manifest.shortcuts) assert.ok(s.url.startsWith('./'), s.url);
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.share_target.action, './');

    const sw = readFileSync(join(out, 'sw.js'), 'utf8');
    const version = sw.match(/const VERSION = '([0-9a-f]{10})';/)?.[1];
    assert.ok(version, 'service worker has a content version');
    const files = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]);
    for (const f of ['./', 'index.html', 'app.js', 'styles.css', 'lib/dates.js', 'lib/store.js', 'lib/ics.js', 'manifest.webmanifest']) {
      assert.ok(files.includes(f), `${f} is precached`);
    }
    for (const f of files.slice(1)) assert.ok(existsSync(join(out, f)), `precached file exists: ${f}`);
    assert.match(readFileSync(join(out, 'app.js'), 'utf8'), new RegExp(`const VERSION = '${version}';`));

    // every module the app imports is shipped
    for (const file of ['app.js', 'lib/store.js', 'lib/ics.js']) {
      const code = readFileSync(join(out, file), 'utf8');
      for (const [, spec] of code.matchAll(/from '(\.[^']+)'/g)) {
        assert.ok(existsSync(join(out, dirname(file), spec)), `${file} imports ${spec}`);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
