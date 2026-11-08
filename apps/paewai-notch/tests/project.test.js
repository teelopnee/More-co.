// Checks that the web app and the Android code agree on the bridge between them, and that the
// manifest keeps the promises made on the download page. The Java side is tested by Gradle
// (PillGeometryTest) during `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const javaDir = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'moreco', 'paewai');
const java = Object.fromEntries(readdirSync(javaDir).map((f) => [f, readFileSync(join(javaDir, f), 'utf8')]));
const appJs = readFileSync(join(root, '..', 'paewai', 'src', 'app.js'), 'utf8');
const manifest = readFileSync(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const a11y = readFileSync(join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'accessibility_service.xml'), 'utf8');

test('every PaewaiAndroid call in the web app exists in Bridge.java', () => {
  const exposed = new Set([...java['Bridge.java'].matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\(/g)].map((m) => m[1]));
  const called = new Set([...appJs.matchAll(/\bandroid\??\.(\w+)\(/g)].map((m) => m[1]));
  assert.ok(called.size >= 8, `found ${called.size} calls`);
  for (const name of called) assert.ok(exposed.has(name), `app.js calls android.${name}() but Bridge.java has no @JavascriptInterface ${name}`);
});

test('every paewai.* call from Java exists in the web app', () => {
  const api = appJs.slice(appJs.indexOf('window.paewai = {'));
  const defined = new Set([...api.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]));
  const called = new Set(Object.values(java).flatMap((src) => [...src.matchAll(/paewai\.(\w+)\(/g)].map((m) => m[1])));
  assert.ok(called.size >= 4);
  for (const name of called) assert.ok(defined.has(name), `Java calls paewai.${name}() but window.paewai has no ${name}`);
});

test('the bridge is registered under the name the web app reads', () => {
  assert.match(java["WebHost.java"], /addJavascriptInterface\(.*, "PaewaiAndroid"\);/);
  assert.match(appJs, /window\.PaewaiAndroid/);
});

test('the notch service reads nothing on screen', () => {
  assert.match(a11y, /android:canRetrieveWindowContent="false"/);
  assert.doesNotMatch(a11y, /flagRequestFilterKeyEvents|flagRetrieveInteractiveWindows/);
  assert.match(manifest, /android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"/);
});

test('panel mode is styled and the web assets the APK bundles exist', () => {
  for (const f of ['index.html', 'app.js', 'styles.css', 'lib/dates.js', 'lib/store.js', 'lib/ics.js', 'icons/icon-192.png']) {
    assert.ok(existsSync(join(root, '..', 'paewai', 'src', f)), f);
  }
  const css = readFileSync(join(root, '..', 'paewai', 'src', 'styles.css'), 'utf8');
  assert.match(css, /html\.panel/);
  assert.match(java['WebHost.java'], /index\.html\?mode=/);
});

test('download page: relative links and the placeholders the build fills', () => {
  const page = readFileSync(join(root, 'page', 'index.html'), 'utf8');
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<meta charset="utf-8">/);
  assert.match(page, /<meta name="viewport"/);
  for (const [, ref] of page.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    assert.ok(!ref.startsWith('/') && !/^https?:/.test(ref), `absolute URL: ${ref}`);
  }
  for (const p of ['{{SIZE}}', '{{VERSION}}', '{{SHA256}}', '{{UPDATE}}', '<!--APK-->']) assert.ok(page.includes(p), p);
});
