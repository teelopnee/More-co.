// End-to-end check of the built app in Chromium.
//   npm run build && node tests/e2e/app.e2e.mjs [screenshotDir]
// Scans the synthetic slips, verifies every field, saves, re-scans to check
// duplicate detection, imports a backup, tests share-target + offline, and
// takes phone/tablet screenshots.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = process.argv[2] ?? join(root, 'test-results');
mkdirSync(shots, { recursive: true });
const slipsDir = join(root, 'tests', 'fixtures', 'slips');
const expected = JSON.parse(readFileSync(join(slipsDir, 'expected.json'), 'utf8'));
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => /localhost/.test(String(d)) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
  setTimeout(() => rej(new Error('preview timeout')), 20000);
});

const browser = await chromium.launch();
const errors = [];
let step = 'start';
const log = (s) => {
  step = s;
  console.log(`• ${s}`);
};

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  log('open app');
  await page.goto(BASE);
  await page.getByText('ยังไม่มีรายการ').waitFor();
  await page.screenshot({ path: join(shots, '01-phone-empty.png') });

  log('set my names');
  await page.goto(`${BASE}#/settings`);
  for (const n of ['ธนพล', 'THANAPHON']) {
    await page.getByLabel('เพิ่มชื่อ').fill(n);
    await page.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
    await page.getByRole('button', { name: `ลบ ${n}` }).waitFor();
  }

  log('scan 8 slips');
  await page.goto(`${BASE}#/`);
  await page.getByTestId('slip-input').setInputFiles(expected.map((e) => join(slipsDir, e.file)));
  await page.waitForURL(/#\/scan/);
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-testid=slip-card]');
    return cards.length === 8 && [...cards].every((c) => c.getAttribute('aria-busy') === 'false');
  }, null, { timeout: 180000 });
  await page.screenshot({ path: join(shots, '02-phone-review.png'), fullPage: false });

  log('verify parsed fields');
  const cards = page.getByTestId('slip-card');
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const card = cards.nth(i);
    const include = await card.getByRole('checkbox').isChecked();
    if (exp.notSlip) {
      assert.equal(include, false, `${exp.file} should be excluded`);
      continue;
    }
    assert.equal(include, true, `${exp.file} included`);
    assert.equal(Number((await card.getByTestId('slip-amount').inputValue()).replace(/,/g, '')), exp.amount, `${exp.file} amount`);
    assert.equal(await card.getByTestId('slip-date').inputValue(), exp.date, `${exp.file} date`);
    assert.equal(await card.getByTestId('slip-time').inputValue(), exp.time, `${exp.file} time`);
    const party = await card.getByTestId('slip-party').inputValue();
    const want = exp.income ? exp.from : exp.to;
    const strip = (s) => s.normalize('NFC').replace(/[ัิ-ฺ็-๎\s]/g, '').toLowerCase();
    assert.ok(strip(party).includes(strip(want)), `${exp.file} party "${party}" ~ "${want}"`);
    const incomePressed = await card.getByRole('button', { name: 'รายรับ' }).getAttribute('aria-pressed');
    assert.equal(incomePressed === 'true', !!exp.income, `${exp.file} direction`);
  }

  log('save');
  await page.getByTestId('save-slips').click();
  await page.waitForURL((u) => !u.hash.includes('scan'));
  await page.getByText('บันทึกแล้ว 7 รายการ').waitFor();
  // November: 1,250 + 89 + 520 + 65 = 1,924 spent.
  assert.equal(await page.getByTestId('total-expense').innerText(), '฿1,924');
  await page.screenshot({ path: join(shots, '03-phone-home.png') });

  log('re-scan same slips → duplicates');
  await page.getByTestId('slip-input').setInputFiles(expected.slice(0, 7).map((e) => join(slipsDir, e.file)));
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-testid=slip-card]');
    return cards.length === 7 && [...cards].every((c) => c.getAttribute('aria-busy') === 'false');
  }, null, { timeout: 60000 });
  assert.equal(await page.getByText('บันทึกไปแล้ว (ซ้ำ)').count(), 7);
  assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'ปิด' }).click();

  log('edit a transaction');
  await page.waitForURL((u) => !u.hash.includes('scan'));
  await page.getByRole('button', { name: /ก๋วยเต/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /เครื่องดื่ม/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByText('แก้ไขแล้ว').waitFor();

  log('delete + undo');
  await page.getByRole('button', { name: /MS SUDARAT/ }).click();
  await page.getByRole('button', { name: 'ลบรายการ' }).click();
  await page.getByText('ลบรายการแล้ว').waitFor();
  assert.equal(await page.getByTestId('total-expense').innerText(), '฿1,404');
  await page.getByRole('button', { name: 'เลิกทำ' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=total-expense]')?.textContent === '฿1,924');

  log('manual entry');
  await page.getByRole('button', { name: 'จดเอง' }).click();
  await page.getByRole('dialog').locator('input[inputmode=decimal]').fill('45');
  await page.getByRole('dialog').getByRole('button', { name: /เดินทาง/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=total-expense]')?.textContent === '฿1,969');

  log('import backup (seed data)');
  const seed = makeSeed();
  const seedPath = join(shots, 'seed-backup.json');
  writeFileSync(seedPath, JSON.stringify(seed));
  await page.goto(`${BASE}#/settings`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /กู้คืน/ }).click()]);
  await chooser.setFiles(seedPath);
  await page.getByText(`กู้คืนแล้ว: เพิ่ม ${seed.txs.length}`).waitFor();

  log('share target via service worker');
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.controller || new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r)));
  const shared = readFileSync(join(slipsDir, 'a-transfer-thai-short-year.png')).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('slips', new File([bytes], 'shared.png', { type: 'image/png' }));
    await fetch('./share-target', { method: 'POST', body: fd });
  }, shared);
  await page.goto(`${BASE}#/scan?shared=1`);
  await page.getByText('บันทึกไปแล้ว (ซ้ำ)').waitFor({ timeout: 60000 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'ปิด' }).click();

  log('offline reload');
  await ctx.setOffline(true);
  await page.reload();
  await page.getByTestId('total-expense').waitFor();
  await ctx.setOffline(false);

  log('phone screenshots');
  await page.goto(`${BASE}#/`);
  await page.getByTestId('total-expense').waitFor();
  await page.screenshot({ path: join(shots, '04-phone-home-full.png') });
  await page.goto(`${BASE}#/stats`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, '05-phone-stats.png'), fullPage: true });
  await page.goto(`${BASE}#/`);
  await page.getByRole('button', { name: /กมลชนก|แสงทอง/ }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, '06-phone-edit.png') });
  await page.keyboard.press('Escape');

  log('tablet screenshots (Galaxy Tab S12 Ultra-ish, landscape + portrait)');
  for (const [name, vp, theme] of [
    ['07-tablet-home', { width: 1316, height: 822 }, 'light'],
    ['08-tablet-stats-dark', { width: 1316, height: 822 }, 'dark'],
    ['09-tablet-portrait-review', { width: 822, height: 1316 }, 'light'],
  ]) {
    await page.setViewportSize(vp);
    await page.emulateMedia({ colorScheme: theme });
    if (name.includes('stats')) await page.goto(`${BASE}#/stats`);
    else if (name.includes('review')) {
      await page.goto(`${BASE}#/`);
      await page.getByTestId('slip-input').setInputFiles(['b-merchant-thai-full-year.png', 'e-income-to-me.png', 'g-colored-background.png', 'h-not-a-slip.png'].map((f) => join(slipsDir, f)));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=slip-card]')].every((c) => c.getAttribute('aria-busy') === 'false') && document.querySelectorAll('[data-testid=slip-card]').length === 4, null, { timeout: 60000 });
    } else await page.goto(`${BASE}#/`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, `${name}.png`) });
  }

  // Tesseract prints informational messages on stderr; they are not app errors.
  const realErrors = errors.filter((e) => !/favicon|Failed to load resource.*(404)|Parameter not found|Estimating resolution|Image too small|Line cannot be recognized|Empty page/.test(e));
  assert.deepEqual(realErrors, [], 'no console errors');
  console.log(`\nE2E PASSED — screenshots in ${shots}`);
} catch (err) {
  console.error(`\nE2E FAILED at step "${step}":`, err.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  setTimeout(() => process.exit(), 500);
}

function makeSeed() {
  const pad = (n) => String(n).padStart(2, '0');
  const items = [
    ['10-02', 'expense', 'home', 4500, 'ค่าห้อง', 'หอพักสุขใจ'],
    ['10-05', 'expense', 'food', 120, '', 'ร้านข้าวแกงป้าศรี'],
    ['10-09', 'expense', 'bills', 599, 'ค่าเน็ตบ้าน', '3BB'],
    ['10-15', 'expense', 'shopping', 890, '', 'SHOPEE'],
    ['10-21', 'expense', 'transport', 300, 'เติมน้ำมัน', 'ปตท.'],
    ['10-25', 'income', 'side', 2500, 'งานฟรีแลนซ์', 'บริษัท ดีไซน์ดี จำกัด'],
    ['11-01', 'expense', 'drink', 75, '', 'คาเฟ่อเมซอน'],
    ['11-01', 'income', 'salary', 25000, 'เงินเดือน ต.ค.', 'บริษัท มอร์ จำกัด'],
    ['11-02', 'expense', 'transport', 62, '', 'BTS'],
    ['11-02', 'expense', 'food', 159, '', 'GRAB FOOD'],
    ['11-03', 'expense', 'bills', 299, 'ค่าโทรศัพท์', 'AIS'],
    ['11-03', 'expense', 'health', 240, '', 'ร้านยาเภสัชกร'],
  ];
  const now = Date.now();
  return {
    app: 'jodwai',
    version: 1,
    exportedAt: new Date().toISOString(),
    myNames: [],
    categories: [],
    rules: [],
    txs: items.map(([md, type, categoryId, baht, note, counterparty], i) => ({
      id: `seed-${i}`,
      type,
      amount: baht * 100,
      date: `2026-${md}`,
      time: `${pad(8 + (i % 12))}:${pad((i * 7) % 60)}`,
      categoryId,
      counterparty,
      note,
      source: 'manual',
      createdAt: now + i,
      updatedAt: now + i,
    })),
  };
}
