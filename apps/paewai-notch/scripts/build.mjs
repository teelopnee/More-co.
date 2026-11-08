#!/usr/bin/env node
// Builds the Android app (APK) plus a download page into dist/.
// The APK carries the web app from ../paewai/src as assets/web, so both share one codebase.
//
// Needs Java 17+ and an Android SDK (ANDROID_HOME). GitHub's ubuntu runners have both.
// Outside CI without an SDK it writes the page only, so `node scripts/build-site.mjs` still works.
//
//   node scripts/build.mjs            PAEWAI_GRADLE=/path/to/gradle to use a Gradle you already have

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');
const web = join(root, '..', 'paewai', 'src');
const out = join(root, 'dist');
const ci = !!process.env.GITHUB_ACTIONS;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The web app goes in as assets.
const assets = join(android, 'app', 'src', 'main', 'assets', 'web');
rmSync(assets, { recursive: true, force: true });
cpSync(web, assets, { recursive: true });

// 2. Version: build time (always increasing, so a new APK installs over the old one) + commit.
const sha = (process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim().slice(0, 7);
const now = new Date();
const versionCode = Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60_000);
const versionName = `${now.toISOString().slice(0, 10).replace(/-/g, '.')}${sha ? `-${sha}` : ''}`;

// 3. Gradle.

/**
 * The wrapper's own downloader stalls on services.gradle.org's redirect (seen on GitHub's runners
 * and elsewhere), so fetch the pinned distribution with curl, check it, and cache it.
 * Returns the gradle binary, or null to fall back to ./gradlew.
 */
function fetchGradle() {
  const version = '8.14.3';
  const sha256 = 'bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531';
  if (process.platform === 'win32') return null;
  const home = join(process.env.RUNNER_TOOL_CACHE || tmpdir(), 'paewai-gradle');
  const bin = join(home, `gradle-${version}`, 'bin', 'gradle');
  if (existsSync(bin)) return bin;
  mkdirSync(home, { recursive: true });
  const zip = join(home, `gradle-${version}-bin.zip`);
  for (const url of [
    `https://github.com/gradle/gradle-distributions/releases/download/v${version}/gradle-${version}-bin.zip`,
    `https://services.gradle.org/distributions/gradle-${version}-bin.zip`,
  ]) {
    const got = spawnSync('curl', ['-fsSL', '--retry', '3', '--connect-timeout', '20', '-o', zip, url], { stdio: 'inherit' });
    if (got.status !== 0 || !existsSync(zip)) continue;
    if (createHash('sha256').update(readFileSync(zip)).digest('hex') !== sha256) {
      console.warn(`paewai-notch: checksum ไม่ตรง ${url}`);
      rmSync(zip, { force: true });
      continue;
    }
    const unzipped = spawnSync('unzip', ['-q', '-o', zip, '-d', home], { stdio: 'inherit' });
    rmSync(zip, { force: true });
    if (unzipped.status === 0 && existsSync(bin)) return bin;
  }
  console.warn('paewai-notch: ดาวน์โหลด Gradle เองไม่ได้ ใช้ gradlew แทน');
  return null;
}

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
let apk = null;
let stable = false;
let keyDir = null;
if (!sdk) {
  if (ci) {
    console.error('paewai-notch: ไม่เจอ Android SDK (ANDROID_HOME)');
    process.exit(1);
  }
  console.warn('paewai-notch: ไม่มี Android SDK ในเครื่องนี้ ข้ามการสร้าง APK (บน GitHub Actions จะสร้างให้)');
} else {
  const gradle = process.env.PAEWAI_GRADLE || fetchGradle() || join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const env = { ...process.env, ANDROID_HOME: sdk, PAEWAI_VERSION_CODE: String(versionCode), PAEWAI_VERSION_NAME: versionName };
  // The stable signing key comes from a GitHub secret (base64 of the .p12), never from the repo.
  if (process.env.PAEWAI_KEYSTORE_B64 && process.env.PAEWAI_KEYSTORE_PASSWORD) {
    keyDir = mkdtempSync(join(tmpdir(), 'paewai-key-'));
    env.PAEWAI_KEYSTORE = join(keyDir, 'release.p12');
    writeFileSync(env.PAEWAI_KEYSTORE, Buffer.from(process.env.PAEWAI_KEYSTORE_B64, 'base64'), { mode: 0o600 });
    stable = true;
  }
  delete env.PAEWAI_KEYSTORE_B64;
  process.on('exit', () => keyDir && rmSync(keyDir, { recursive: true, force: true }));
  const args = ['--no-daemon', '--console=plain', 'testReleaseUnitTest', 'assembleRelease'];
  let ok = false;
  // Maven Central sometimes answers 429 (too many requests); try again before giving up.
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    if (attempt > 1) console.log(`paewai-notch: Gradle ไม่ผ่าน ลองใหม่ครั้งที่ ${attempt}`);
    const r = spawnSync(gradle, args, { cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32' });
    ok = r.status === 0;
    if (!ok && attempt < 3) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 15000)']);
  }
  if (!ok) {
    console.error('paewai-notch: สร้าง APK ไม่ผ่าน');
    process.exit(1);
  }
  apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(apk)) {
    console.error(`paewai-notch: ไม่เจอ ${apk}`);
    process.exit(1);
  }
  cpSync(apk, join(out, 'paewai-notch.apk'));
}

// 4. Download page.
cpSync(join(web, 'icons'), join(out, 'icons'), { recursive: true });
const kb = apk ? Math.round(statSync(apk).size / 1024) : 0;
const hash = apk ? createHash('sha256').update(readFileSync(apk)).digest('hex') : '';
const notice = !apk
  ? '<p class="warn">ยังไม่มีไฟล์ APK ในรุ่นนี้ (สร้างบน GitHub Actions)</p>'
  : stable
    ? ''
    : '<p class="warn">รุ่นทดลอง: ยังไม่ได้ตั้งกุญแจเซ็นแอป รุ่นถัดไปจะติดตั้งทับรุ่นนี้ไม่ได้ ต้องสำรองข้อมูล ลบแอป แล้วติดตั้งใหม่</p>';
const page = readFileSync(join(root, 'page', 'index.html'), 'utf8')
  .replace('<!--APK-->', notice)
  .replaceAll('{{UPDATE}}', stable ? 'ติดตั้งทับรุ่นเก่าได้ ข้อมูลไม่หาย' : 'รุ่นทดลอง')
  .replaceAll('{{SIZE}}', apk ? `${kb} KB` : '-')
  .replaceAll('{{VERSION}}', versionName)
  .replaceAll('{{SHA256}}', hash || '-');
writeFileSync(join(out, 'index.html'), page);
console.log(`แปะไว้ ที่ notch ${versionName}: ${apk ? `paewai-notch.apk ${kb} KB` : 'ไม่มี APK'} → dist`);
