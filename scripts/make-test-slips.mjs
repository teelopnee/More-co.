// Generates synthetic Thai bank-transfer slips (PNG) for testing the slip reader.
// Layouts are generic and unbranded; they mimic the information structure of
// real e-slips (labels, masked accounts, Thai dates, reference no., mini-QR).
//
// Usage: node scripts/make-test-slips.mjs   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests', 'fixtures', 'slips');
mkdirSync(outDir, { recursive: true });

const font = (pkg, file) =>
  `data:font/woff2;base64,${readFileSync(join(root, 'node_modules', '@fontsource', pkg, 'files', file)).toString('base64')}`;
const fontFaces = ['ibm-plex-sans-thai', 'sarabun']
  .flatMap((pkg) =>
    ['thai', 'latin'].flatMap((subset) =>
      [400, 600].map(
        (w) => `@font-face{font-family:'${pkg}';font-weight:${w};src:url(${font(pkg, `${pkg}-${subset}-${w}-normal.woff2`)}) format('woff2');}`,
      ),
    ),
  )
  .join('\n');

// EMVCo-style TLV used by the Thai slip-verification mini QR.
const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;
const crc16 = (s) => {
  let crc = 0xffff;
  for (const ch of s) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};
const slipQr = (bank, ref) => {
  const body = tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref)) + tlv('51', 'TH') + '9104';
  return body + crc16(body);
};
const qrImg = async (text) => QRCode.toDataURL(text, { margin: 1, width: 240 });

const page = (fontFamily, body, bg = '#fff') => `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces}
*{box-sizing:border-box;margin:0;padding:0}
body{width:390px;font-family:'${fontFamily}',Loma,sans-serif;background:${bg};color:#1d1d1f}
.slip{padding:28px 24px 32px}
.row{display:flex;justify-content:space-between;align-items:baseline;margin:10px 0;font-size:15px}
.muted{color:#6b6b70}
.big{font-size:26px;font-weight:600}
.title{font-size:20px;font-weight:600;margin-bottom:4px}
.party{display:flex;gap:12px;align-items:center;margin:14px 0}
.avatar{width:44px;height:44px;border-radius:50%;background:#d8dbe2;flex:none}
.name{font-size:16px;font-weight:600}
.sub{font-size:13px;color:#6b6b70}
hr{border:none;border-top:1px dashed #c9c9cf;margin:16px 0}
.qr{display:flex;justify-content:flex-end;margin-top:12px}
.qr img{width:96px;height:96px}
</style></head><body>${body}</body></html>`;

const slips = [
  {
    file: 'a-transfer-thai-short-year.png',
    font: 'ibm-plex-sans-thai',
    dpr: 3,
    qr: slipQr('004', '015307142236ATF01234'),
    html: (qr) => `<div class="slip">
      <div class="title" style="color:#0a7a3e">โอนเงินสำเร็จ</div>
      <div class="muted">3 พ.ย. 69 14:22 น.</div>
      <div class="party"><div class="avatar"></div><div><div class="name">นาย ธนพล มีทรัพย์</div><div class="sub">ธ.กสิกรไทย</div><div class="sub">xxx-x-x1234-x</div></div></div>
      <div class="party"><div class="avatar"></div><div><div class="name">น.ส. กมลชนก แสงทอง</div><div class="sub">ธ.ไทยพาณิชย์</div><div class="sub">xxx-x-x5678-x</div></div></div>
      <hr>
      <div class="row"><span class="muted">เลขที่รายการ:</span><span>015307142236ATF01234</span></div>
      <div class="row"><span class="muted">จำนวน:</span><span class="big">1,250.00 บาท</span></div>
      <div class="row"><span class="muted">ค่าธรรมเนียม:</span><span>0.00 บาท</span></div>
      <div class="row"><span class="muted">บันทึกช่วยจำ:</span><span>ค่าข้าว</span></div>
      <div class="qr"><img src="${qr}"></div></div>`,
    expect: { amount: 1250, date: '2026-11-03', time: '14:22', from: 'ธนพล', to: 'แสงทอง', ref: '015307142236ATF01234', memo: 'ค่าข้าว', bank: 'kbank' },
  },
  {
    file: 'b-merchant-thai-full-year.png',
    font: 'sarabun',
    dpr: 3,
    qr: slipQr('014', '202611034h7Kp2Qx9'),
    html: (qr) => `<div class="slip">
      <div style="text-align:center"><div class="title" style="color:#4e2a84">โอนเงินสำเร็จ</div>
      <div class="muted">03 พ.ย. 2569 - 08:15</div>
      <div class="muted" style="font-size:13px">รหัสอ้างอิง: 202611034h7Kp2Qx9</div></div>
      <hr>
      <div class="row"><span class="muted">จาก</span><span style="text-align:right">นาย ธนพล มีทรัพย์<br><span class="sub">xxx-xxx123-4</span></span></div>
      <div class="row"><span class="muted">ไปยัง</span><span style="text-align:right">บริษัท ซีพี ออลล์ จำกัด (มหาชน)<br><span class="sub">Biller ID: 010754200001101</span></span></div>
      <hr>
      <div class="row"><span class="muted">จำนวนเงิน</span><span class="big">89.00</span></div>
      <div class="qr" style="justify-content:center"><img src="${qr}"></div></div>`,
    expect: { amount: 89, date: '2026-11-03', time: '08:15', from: 'ธนพล', to: 'ซีพี ออลล์', ref: '202611034h7Kp2Qx9', bank: 'scb' },
  },
  {
    file: 'c-labels-left-loma.png',
    font: 'Loma',
    dpr: 2,
    qr: null,
    html: () => `<div class="slip">
      <div class="title" style="color:#00a0e1">โอนเงินสำเร็จ</div>
      <div class="row"><span class="muted">รหัสอ้างอิง</span><span>KTB2610280905117734</span></div>
      <div class="row"><span class="muted">ผู้โอน</span><span>นาย ธนพล มีทรัพย์</span></div>
      <div class="row"><span class="muted">ผู้รับ</span><span>นาย สมศักดิ์ ทองดี</span></div>
      <div class="row"><span class="muted">จำนวนเงิน</span><span class="big">3,500.00 บาท</span></div>
      <div class="row"><span class="muted">ค่าธรรมเนียม</span><span>0.00 บาท</span></div>
      <div class="row"><span class="muted">วันที่ทำรายการ</span><span>28 ต.ค. 2569 - 09:05</span></div>
      <div class="row"><span class="muted">บันทึกช่วยจำ</span><span>ค่าเช่าห้อง</span></div></div>`,
    expect: { amount: 3500, date: '2026-10-28', time: '09:05', from: 'ธนพล', to: 'สมศักดิ์', ref: 'KTB2610280905117734', memo: 'ค่าเช่าห้อง' },
  },
  {
    file: 'd-english.png',
    font: 'ibm-plex-sans-thai',
    dpr: 3,
    qr: slipQr('002', '20261101BBL18405521'),
    html: (qr) => `<div class="slip">
      <div class="title" style="color:#1e4598">Transfer successful</div>
      <hr>
      <div class="row"><span class="muted">From</span><span>MR THANAPHON MEESAP</span></div>
      <div class="row"><span class="muted">To</span><span>MS SUDARAT WONGSA</span></div>
      <div class="row"><span class="muted">Amount</span><span class="big">520.00 THB</span></div>
      <div class="row"><span class="muted">Fee</span><span>0.00 THB</span></div>
      <div class="row"><span class="muted">Transaction date</span><span>01 Nov 2026 18:40</span></div>
      <div class="row"><span class="muted">Reference no.</span><span>20261101BBL18405521</span></div>
      <div class="qr"><img src="${qr}"></div></div>`,
    expect: { amount: 520, date: '2026-11-01', time: '18:40', from: 'THANAPHON', to: 'SUDARAT', ref: '20261101BBL18405521', bank: 'bbl' },
  },
  {
    file: 'e-income-to-me.png',
    font: 'ibm-plex-sans-thai',
    dpr: 3,
    qr: slipQr('006', '017304170255BPM04411'),
    html: (qr) => `<div class="slip">
      <div class="title" style="color:#0a7a3e">โอนเงินสำเร็จ</div>
      <div class="muted">31 ต.ค. 69 17:02 น.</div>
      <div class="party"><div class="avatar"></div><div><div class="name">นาย วิชัย ศรีสุข</div><div class="sub">ธ.กรุงไทย</div><div class="sub">xxx-x-x9012-x</div></div></div>
      <div class="party"><div class="avatar"></div><div><div class="name">นาย ธนพล มีทรัพย์</div><div class="sub">ธ.กสิกรไทย</div><div class="sub">xxx-x-x1234-x</div></div></div>
      <hr>
      <div class="row"><span class="muted">เลขที่รายการ:</span><span>017304170255BPM04411</span></div>
      <div class="row"><span class="muted">จำนวน:</span><span class="big">15,000.00 บาท</span></div>
      <div class="row"><span class="muted">ค่าธรรมเนียม:</span><span>0.00 บาท</span></div>
      <div class="row"><span class="muted">บันทึกช่วยจำ:</span><span>เงินเดือน</span></div>
      <div class="qr"><img src="${qr}"></div></div>`,
    expect: { amount: 15000, date: '2026-10-31', time: '17:02', from: 'วิชัย', to: 'ธนพล', ref: '017304170255BPM04411', memo: 'เงินเดือน', bank: 'ktb', income: true },
  },
  {
    file: 'f-payment-full-month.png',
    font: 'sarabun',
    dpr: 2,
    qr: null,
    html: () => `<div class="slip">
      <div style="text-align:center"><div class="title" style="color:#d4691e">ชำระเงินสำเร็จ</div>
      <div class="muted">2 พฤศจิกายน 2569 12:31 น.</div></div>
      <hr>
      <div class="row"><span class="muted">ร้านค้า</span><span>ร้าน ก๋วยเตี๋ยวเรือป้าแดง</span></div>
      <div class="row"><span class="muted">ยอดชำระ</span><span class="big">65.00 บาท</span></div>
      <div class="row"><span class="muted">หมายเลขอ้างอิง</span><span>P2611021231009876</span></div></div>`,
    expect: { amount: 65, date: '2026-11-02', time: '12:31', to: 'ก๋วยเตี๋ยว', ref: 'P2611021231009876' },
  },
  {
    file: 'g-colored-background.png',
    font: 'ibm-plex-sans-thai',
    dpr: 3,
    bg: 'linear-gradient(160deg,#e7f6ec 0%,#c9ecd6 60%,#b3e2c4 100%)',
    qr: slipQr('004', '015306201845ATF07788'),
    html: (qr) => `<div class="slip">
      <div class="title" style="color:#0a7a3e">โอนเงินสำเร็จ</div>
      <div class="muted">6 ก.ย. 69 20:18 น.</div>
      <div class="party"><div class="avatar" style="background:#9fd3b2"></div><div><div class="name">นาย ธนพล มีทรัพย์</div><div class="sub">ธ.กสิกรไทย</div></div></div>
      <div class="party"><div class="avatar" style="background:#9fd3b2"></div><div><div class="name">บริษัท ไลน์แมน (ประเทศไทย) จำกัด</div><div class="sub">พร้อมเพย์</div></div></div>
      <hr>
      <div class="row"><span class="muted">จำนวน:</span><span class="big">249.50 บาท</span></div>
      <div class="row"><span class="muted">ค่าธรรมเนียม:</span><span>0.00 บาท</span></div>
      <div class="qr"><img src="${qr}"></div></div>`,
    expect: { amount: 249.5, date: '2026-09-06', time: '20:18', from: 'ธนพล', to: 'ไลน์แมน', ref: '015306201845ATF07788', bank: 'kbank' },
  },
  {
    file: 'h-not-a-slip.png',
    font: 'sarabun',
    dpr: 2,
    qr: null,
    bg: 'linear-gradient(180deg,#8ec5fc,#e0c3fc)',
    html: () => `<div class="slip" style="height:520px">
      <div class="title">ทริปเชียงใหม่ ✈️</div>
      <p style="margin-top:12px;font-size:16px">อากาศดีมาก ไปดอยสุเทพกับเพื่อน ๆ ถ่ายรูปเยอะเลย</p></div>`,
    expect: { notSlip: true },
  },
];

const browser = await chromium.launch();
const expected = [];
for (const s of slips) {
  const ctx = await browser.newContext({ deviceScaleFactor: s.dpr, viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const qr = s.qr ? await qrImg(s.qr) : null;
  await p.setContent(page(s.font, s.html(qr), s.bg));
  await p.evaluate(() => document.fonts.ready);
  await p.locator('body').screenshot({ path: join(outDir, s.file) });
  await ctx.close();
  expected.push({ file: s.file, qr: s.qr, ...s.expect });
}
await browser.close();
writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log(`wrote ${slips.length} slips to ${outDir}`);
