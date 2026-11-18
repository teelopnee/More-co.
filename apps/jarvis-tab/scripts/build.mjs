#!/usr/bin/env node
// Builds the Jarvis Android app (APK) plus a download page into dist/.
//
// Needs Java 17+ and an Android SDK (ANDROID_HOME). GitHub's ubuntu runners have both.
// Outside CI without an SDK it writes the page only, so `node scripts/build-site.mjs` still works.
//
//   node scripts/build.mjs            JARVIS_GRADLE=/path/to/gradle to use a Gradle you already have

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const android = join(root, 'android');
const out = join(root, 'dist');
const ci = !!process.env.GITHUB_ACTIONS;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Version: build time (always increasing, so a new APK installs over the old one) + commit.
const sha = (process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim().slice(0, 7);
const now = new Date();
const versionCode = Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60_000);
const versionName = `0.3-${now.toISOString().slice(0, 10).replace(/-/g, '.')}${sha ? `-${sha}` : ''}`;

/**
 * The wrapper's own downloader stalls on services.gradle.org's redirect (seen on GitHub's runners),
 * so fetch the pinned distribution with curl, check it, and cache it. Same as paewai-notch.
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
      console.warn(`jarvis-tab: checksum ไม่ตรง ${url}`);
      rmSync(zip, { force: true });
      continue;
    }
    const unzipped = spawnSync('unzip', ['-q', '-o', zip, '-d', home], { stdio: 'inherit' });
    rmSync(zip, { force: true });
    if (unzipped.status === 0 && existsSync(bin)) return bin;
  }
  console.warn('jarvis-tab: ดาวน์โหลด Gradle เองไม่ได้ ใช้ gradlew แทน');
  return null;
}

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
let apk = null;
let stable = false;
let keyDir = null;
if (!sdk) {
  if (ci) {
    console.error('jarvis-tab: ไม่เจอ Android SDK (ANDROID_HOME)');
    process.exit(1);
  }
  console.warn('jarvis-tab: ไม่มี Android SDK ในเครื่องนี้ ข้ามการสร้าง APK (บน GitHub Actions จะสร้างให้)');
} else {
  const gradle = process.env.JARVIS_GRADLE || fetchGradle() || join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const env = { ...process.env, ANDROID_HOME: sdk, JARVIS_VERSION_CODE: String(versionCode), JARVIS_VERSION_NAME: versionName };
  // Kotlin 2.1 + Gradle 8.14 run on Java 17–21; GitHub's runners default to a newer Java (25 fails with
  // just "25.0.5"), but ship 21 and 17 side by side as JAVA_HOME_21_X64 / JAVA_HOME_17_X64.
  const jdk = [process.env.JARVIS_JAVA_HOME, process.env.JAVA_HOME_21_X64, process.env.JAVA_HOME_17_X64].find((p) => p && existsSync(p));
  if (jdk) {
    env.JAVA_HOME = jdk;
    env.PATH = `${join(jdk, 'bin')}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`;
    console.log(`jarvis-tab: ใช้ Java จาก ${jdk}`);
  }
  // The stable signing key comes from GitHub secrets (the same key as paewai-notch), never from the repo.
  if (process.env.PAEWAI_KEYSTORE_B64 && process.env.PAEWAI_KEYSTORE_PASSWORD) {
    keyDir = mkdtempSync(join(tmpdir(), 'jarvis-key-'));
    env.JARVIS_KEYSTORE = join(keyDir, 'release.p12');
    env.JARVIS_KEYSTORE_PASSWORD = process.env.PAEWAI_KEYSTORE_PASSWORD;
    env.JARVIS_KEY_ALIAS = process.env.PAEWAI_KEY_ALIAS || 'paewai';
    writeFileSync(env.JARVIS_KEYSTORE, Buffer.from(process.env.PAEWAI_KEYSTORE_B64, 'base64'), { mode: 0o600 });
    stable = true;
  }
  delete env.PAEWAI_KEYSTORE_B64;
  process.on('exit', () => keyDir && rmSync(keyDir, { recursive: true, force: true }));
  // :core:test = ทดสอบสมอง + คำปลุก "Hey Jarvis" ด้วยไฟล์เสียงจริง ก่อนสร้าง APK
  const args = ['--no-daemon', '--console=plain', ':core:test', 'assembleRelease'];
  let ok = false;
  // Maven Central sometimes answers 429 (too many requests); try again before giving up.
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    if (attempt > 1) console.log(`jarvis-tab: Gradle ไม่ผ่าน ลองใหม่ครั้งที่ ${attempt}`);
    const r = spawnSync(gradle, args, { cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32' });
    ok = r.status === 0;
    if (!ok && attempt < 3) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 15000)']);
  }
  if (!ok) {
    console.error('jarvis-tab: สร้าง APK ไม่ผ่าน');
    process.exit(1);
  }
  apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(apk)) {
    console.error(`jarvis-tab: ไม่เจอ ${apk}`);
    process.exit(1);
  }
  cpSync(apk, join(out, 'jarvis-tab.apk'));
}

// Download page.
cpSync(join(root, 'page', 'icons'), join(out, 'icons'), { recursive: true });
const mb = apk ? (statSync(apk).size / 1024 / 1024).toFixed(0) : 0;
const hash = apk ? createHash('sha256').update(readFileSync(apk)).digest('hex') : '';
const notice = !apk
  ? '<p class="warn">ยังไม่มีไฟล์ APK ในรุ่นนี้ (สร้างบน GitHub Actions)</p>'
  : stable
    ? ''
    : '<p class="warn">รุ่นทดลอง: ยังไม่ได้ตั้งกุญแจเซ็นแอป รุ่นถัดไปจะติดตั้งทับรุ่นนี้ไม่ได้ ต้องลบแอปก่อนแล้วติดตั้งใหม่ (ประวัติคำถามจะหาย)</p>';
const page = readFileSync(join(root, 'page', 'index.html'), 'utf8')
  .replace('<!--APK-->', notice)
  .replaceAll('{{UPDATE}}', stable ? 'ติดตั้งทับรุ่นเก่าได้ ข้อมูลไม่หาย' : 'รุ่นทดลอง')
  .replaceAll('{{SIZE}}', apk ? `${mb} MB` : '-')
  .replaceAll('{{VERSION}}', versionName)
  .replaceAll('{{SHA256}}', hash || '-');
writeFileSync(join(out, 'index.html'), page);
console.log(`Jarvis ${versionName}: ${apk ? `jarvis-tab.apk ${mb} MB` : 'ไม่มี APK'} → dist`);
