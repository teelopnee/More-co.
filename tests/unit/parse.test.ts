import { describe, expect, it } from 'vitest';
import { guessDirection, parseSlip } from '../../src/slip/parse';
import { findDate, findTime, toCeYear } from '../../src/slip/thaiDate';
import { parseSlipQr } from '../../src/slip/qr';
import { fuzzyIncludes, normalizeOcr, skeleton } from '../../src/slip/text';
import { DEFAULT_CATEGORIES, counterpartyKey, guessCategory } from '../../src/lib/categories';

const QR_A = '0041000600000101030040220015307142236ATF012345102TH9104ABCD';

describe('text helpers', () => {
  it('fixes decomposed sara am and Thai digits', () => {
    expect(normalizeOcr('จํานวน ๑๒๓')).toBe('จำนวน 123');
  });
  it('matches labels despite dropped tone marks', () => {
    expect(skeleton('ร้านค้า')).toBe(skeleton('รานคา'));
    expect(fuzzyIncludes('จ้านวนเงิน   89.00', 'จำนวนเงิน')).toBe(true);
    expect(fuzzyIncludes('จําแวน:   249.50 บาท', 'จำนวน')).toBe(true);
    expect(fuzzyIncludes('ค่าธรรมเนียม: 0.00', 'จำนวน')).toBe(false);
  });
});

describe('dates', () => {
  it.each([
    ['3 พ.ย. 69 14:22 น.', '2026-11-03', '14:22'],
    ['3 พุย.69 14:22 น.', '2026-11-03', '14:22'],
    ['03 พ.ุย. 2569 - 08:15', '2026-11-03', '08:15'],
    ['31 ต.ุค. 69 17:02 u.', '2026-10-31', '17:02'],
    ['6 กุย. 69 20:18 u.', '2026-09-06', '20:18'],
    ['2 พฤศจิกายน 2569 12:31 น.', '2026-11-02', '12:31'],
    ['วันที่ทํารายการ   28 ต.ค. 2569 - 09:05', '2026-10-28', '09:05'],
    ['Transaction date   01 Nov 2026 18:40', '2026-11-01', '18:40'],
    ['Nov 1, 2026 6:05', '2026-11-01', '06:05'],
    ['03/11/2569 21:09', '2026-11-03', '21:09'],
    ['15 มี.ค. 70', '2027-03-15', null],
    ['15 ม.ค. 70', '2027-01-15', null],
  ])('%s', (line, date, time) => {
    const d = findDate([line]);
    expect(d?.date).toBe(date);
    expect(findTime([line], 0)).toBe(time);
  });
  it('converts years', () => {
    expect(toCeYear(2569)).toBe(2026);
    expect(toCeYear(69)).toBe(2026);
    expect(toCeYear(2026)).toBe(2026);
  });
  it('does not treat an amount as a time', () => {
    expect(findTime(['จำนวน 14.50 บาท'])).toBeNull();
  });
});

describe('slip QR', () => {
  it('reads bank code and transaction ref', () => {
    const q = parseSlipQr(QR_A);
    expect(q?.bankCode).toBe('004');
    expect(q?.transRef).toBe('015307142236ATF01234');
  });
  it('keeps unknown QR text as a key', () => {
    expect(parseSlipQr('hello')).toEqual({ raw: 'hello', bankCode: null, transRef: null });
  });
});

describe('parseSlip on OCR text', () => {
  it('reads an unlabelled two-party slip', () => {
    const s = parseSlip(`โอนเงินสําเร็จ
3 พุย.69 14:22 น.
นาย ธนพล มีทรัพย์
ธ.กสิกรไทย
2๐๐%-%1234-%
u.d. nasun แสงทอง
ธ.ไทยพาณิชย์
XXX-X-X5678-X
เลขที่รายการ:             015307142236ATF01234
จํานวน:                 1,250.00 บาท
ค่าธรรมเนียม:                               0.00 บาท
บันทึกช่วยจํา:                           ค่าข้าว`);
    expect(s).toMatchObject({ isSlip: true, amount: 1250, fee: 0, date: '2026-11-03', time: '14:22', memo: 'ค่าข้าว', ref: '015307142236ATF01234' });
    expect(s.from).toContain('ธนพล');
    expect(s.to).toContain('แสงทอง');
    expect(s.bank?.id).toBe('kbank');
  });

  it('reads a labelled slip and ignores fee and balance', () => {
    const s = parseSlip(`โอนเงินสําเร็จ
รหัสอ้างอิง                KTB2610280905117734
ผู้โอน                         นาย ธนพล มีทรัพย์
ผู้รับ                             นาย สมศักดิ์ ทองดี
ค่าธรรมเนียม                              5.00 บาท
ยอดเงินคงเหลือ               20,431.55 บาท
จํานวนเงิน                 3,500.00 un
วันที่ทํารายการ                28 ต.ค. 2569 - 09:05`);
    expect(s).toMatchObject({ amount: 3500, fee: 5, date: '2026-10-28', time: '09:05', ref: 'KTB2610280905117734' });
    expect(s.from).toBe('นาย ธนพล มีทรัพย์');
    expect(s.to).toBe('นาย สมศักดิ์ ทองดี');
  });

  it('prefers the most prominent number when no label matches', () => {
    const s = parseSlip([
      { text: 'ชำระเงินสำเร็จ' },
      { text: '2 พ.ย. 69 12:31' },
      { text: 'จ@#นวน    65.00 บาท', digitHeight: 60 },
      { text: 'ส่วนลด    5.00 บาท', digitHeight: 30 },
    ]);
    expect(s.amount).toBe(65);
  });

  it('rejects images without an amount', () => {
    const s = parseSlip(`ทริปเชียงใหม่ “4
อากาศดีมาก ไปดอยสุเทพกับเพื่อน ๆ ถ่ายรูปเยอะเลย`);
    expect(s.isSlip).toBe(false);
  });

  it('uses the QR transaction ref as duplicate key', () => {
    const s = parseSlip('โอนเงินสำเร็จ\nจำนวน 10.00 บาท', QR_A);
    expect(s.dedupeKey).toBe('qr:015307142236ATF01234');
  });
});

describe('direction and category', () => {
  it('detects money sent to me as income', () => {
    expect(guessDirection({ from: 'นาย วิชัย ศรีสุข', to: 'นาย ธนพล มีทรัพย์', received: false }, ['ธนพล'])).toBe('income');
    expect(guessDirection({ from: 'นาย ธนพล มีทรัพย์', to: 'ร้าน ก', received: false }, ['ธนพล'])).toBe('expense');
    expect(guessDirection({ from: 'MR THANAPHON MEESAP', to: 'MS A', received: false }, ['thanaphon'])).toBe('expense');
  });
  it('guesses categories from memo, counterparty and learned choices', () => {
    const learned = new Map<string, string>();
    expect(guessCategory('expense', 'น.ส. กมลชนก แสงทอง', 'ค่าข้าว', learned, DEFAULT_CATEGORIES)).toBe('food');
    expect(guessCategory('expense', 'บริษัท ซีพี ออลล์ จำกัด (มหาชน)', null, learned, DEFAULT_CATEGORIES)).toBe('grocery');
    expect(guessCategory('expense', 'บริษัท ไลน์แมน (ประเทศไทย) จำกัด', null, learned, DEFAULT_CATEGORIES)).toBe('food');
    expect(guessCategory('expense', 'ร้าน ก๋วยเตียวเรือป้าแดง', null, learned, DEFAULT_CATEGORIES)).toBe('food');
    expect(guessCategory('expense', 'MS SUDARAT WONGSA', null, learned, DEFAULT_CATEGORIES)).toBe('transfer');
    expect(guessCategory('income', 'นาย วิชัย ศรีสุข', 'เงินเดือน', learned, DEFAULT_CATEGORIES)).toBe('salary');
    learned.set(counterpartyKey('MS SUDARAT WONGSA')!, 'family');
    expect(guessCategory('expense', 'MS SUDARAT WONGSA', null, learned, DEFAULT_CATEGORIES)).toBe('family');
  });
});
