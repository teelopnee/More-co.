// Checks the promises the download page and README make against the Android project.
// The Kotlin side (agent, wake word with real audio, voice commands) is tested by Gradle
// (:core:test) during `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');
const read = (...p) => readFileSync(join(android, ...p), 'utf8');
const manifest = read('app', 'src', 'main', 'AndroidManifest.xml');
const wake = read('app', 'src', 'main', 'java', 'com', 'smott', 'jarvis', 'wake', 'WakeController.kt');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (['build', '.gradle', '.kotlin'].includes(f) ? [] : walk(p)) : [p];
  });
}

test('wake word models the app loads are in the APK assets', () => {
  const assets = join(android, 'app', 'src', 'main', 'assets', 'wake');
  for (const [, name] of wake.matchAll(/asset\("([^"]+\.onnx)"\)/g)) {
    assert.ok(existsSync(join(assets, name)), `missing asset wake/${name}`);
  }
  assert.equal([...wake.matchAll(/asset\("([^"]+\.onnx)"\)/g)].length, 3);
});

test('microphone foreground service is declared the way Android 14+ requires', () => {
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_MICROPHONE/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android:name="\.wake\.WakeService"[\s\S]*?android:foregroundServiceType="microphone"/);
  assert.match(manifest, /android:exported="false"/);
});

test('research keeps running when the app is closed (dataSync foreground service)', () => {
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(manifest, /android\.permission\.WAKE_LOCK/);
  assert.match(manifest, /android:name="\.research\.ResearchService"[\s\S]*?android:foregroundServiceType="dataSync"/);
  const src = readFileSync(join(root, 'android/app/src/main/java/com/smott/jarvis/research/ResearchService.kt'), 'utf8');
  assert.match(src, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
  // never stopService(): stopping before startForeground() crashes the app
  assert.doesNotMatch(src, /stopService\(/);
});

test('no signing key or local config is committed', () => {
  const bad = walk(root).filter((p) => /\.(jks|keystore|p12|pfx)$/i.test(p) || /local\.properties$/.test(p));
  assert.deepEqual(bad, []);
});

test('model license is stated (CC BY-NC-SA = personal use only)', () => {
  const notice = read('third_party', 'openWakeWord-NOTICE.txt');
  assert.match(notice, /CC|Creative Commons/);
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /CC BY-NC-SA 4\.0/);
});

test('download page: relative links and the placeholders the build fills', () => {
  const page = readFileSync(join(root, 'page', 'index.html'), 'utf8');
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<meta charset="utf-8">/);
  assert.match(page, /<meta name="viewport"/);
  for (const [, ref] of page.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    assert.ok(!ref.startsWith('/') && !/^https?:/.test(ref), `absolute URL: ${ref}`);
    if (ref !== 'jarvis-tab.apk') assert.ok(existsSync(join(root, 'page', ref)), `missing ${ref}`);
  }
  for (const p of ['{{SIZE}}', '{{VERSION}}', '{{SHA256}}', '{{UPDATE}}', '<!--APK-->']) assert.ok(page.includes(p), p);
});
