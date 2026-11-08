import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayLabel, describeWhen, diffDays, normalizeDigits, parseWhen, shortDate } from '../src/lib/dates.js';

// Sunday 8 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 8, 10, 0).getTime();
const when = (s, now = NOW) => {
  const p = parseWhen(s, now);
  return [p.text, p.day, p.time];
};

test('day keys', () => {
  assert.equal(addDays('2026-11-08', 1), '2026-11-09');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(diffDays('2026-11-08', '2026-11-15'), 7);
  assert.equal(normalizeDigits('๑๐ โมง'), '10 โมง');
});

test('labels', () => {
  assert.equal(dayLabel('2026-11-08', '2026-11-08'), 'วันนี้');
  assert.equal(dayLabel('2026-11-09', '2026-11-08'), 'พรุ่งนี้');
  assert.equal(dayLabel('2026-11-07', '2026-11-08'), 'เมื่อวาน');
  assert.equal(dayLabel('2026-11-13', '2026-11-08'), 'ศ. 13 พ.ย.');
  assert.equal(shortDate('2027-01-02', '2026-11-08'), 'ส. 2 ม.ค. 70');
  assert.equal(describeWhen('2026-11-09', '17:00', '2026-11-08'), 'พรุ่งนี้ 17:00 น.');
});

test('no date: text unchanged', () => {
  assert.deepEqual(when('ซื้อนม'), ['ซื้อนม', null, null]);
  assert.deepEqual(when('  ซื้อนม  '), ['ซื้อนม', null, null]);
  assert.deepEqual(when('ดูพระอาทิตย์ตก'), ['ดูพระอาทิตย์ตก', null, null]);
  assert.deepEqual(when('ดูพระจันทร์'), ['ดูพระจันทร์', null, null]);
  assert.deepEqual(when('ทุ่มเทให้งาน'), ['ทุ่มเทให้งาน', null, null]);
  // a bare 18.25 is more likely money than a time
  assert.deepEqual(when('ค่าน้ำ 18.25'), ['ค่าน้ำ 18.25', null, null]);
  assert.deepEqual(when('ทำงาน 24 ชั่วโมง'), ['ทำงาน 24 ชั่วโมง', null, null]);
});

test('relative days', () => {
  assert.deepEqual(when('วันนี้ ส่งของ'), ['ส่งของ', '2026-11-08', null]);
  assert.deepEqual(when('พรุ่งนี้ ไปธนาคาร'), ['ไปธนาคาร', '2026-11-09', null]);
  assert.deepEqual(when('ไปธนาคารพรุ่งนี้'), ['ไปธนาคาร', '2026-11-09', null]);
  assert.deepEqual(when('มะรืนนี้ คืนหนังสือ'), ['คืนหนังสือ', '2026-11-10', null]);
  assert.deepEqual(when('พรุ่งนี้คืนหนังสือ'), ['คืนหนังสือ', '2026-11-09', null]);
  assert.deepEqual(when('อีก 3 วัน ต่อภาษี'), ['ต่อภาษี', '2026-11-11', null]);
  assert.deepEqual(when('อีกสองสัปดาห์ ตรวจฟัน'), ['ตรวจฟัน', '2026-11-22', null]);
  assert.deepEqual(when('call mom tomorrow'), ['call mom', '2026-11-09', null]);
});

test('weekdays (weeks start on Sunday)', () => {
  assert.deepEqual(when('ส่งงานศุกร์นี้'), ['ส่งงาน', '2026-11-13', null]);
  assert.deepEqual(when('ส่งงาน วันศุกร์'), ['ส่งงาน', '2026-11-13', null]);
  assert.deepEqual(when('ส่งงานศุกร์หน้า'), ['ส่งงาน', '2026-11-20', null]);
  assert.deepEqual(when('จันทร์หน้า ประชุม'), ['ประชุม', '2026-11-16', null]);
  assert.deepEqual(when('วันอาทิตย์ ไปวัด'), ['ไปวัด', '2026-11-08', null]);
  assert.deepEqual(when('วันอาทิตย์หน้า ไปวัด'), ['ไปวัด', '2026-11-15', null]);
  assert.deepEqual(when('พฤหัสบดี ล้างแอร์'), ['ล้างแอร์', '2026-11-12', null]);
  assert.deepEqual(when('ไปทะเลเสาร์อาทิตย์'), ['ไปทะเล', '2026-11-14', null]);
  assert.deepEqual(when('สัปดาห์หน้า ทำภาษี'), ['ทำภาษี', '2026-11-16', null]);
  assert.deepEqual(when('อาทิตย์หน้า ทำภาษี'), ['ทำภาษี', '2026-11-16', null]);
  // Saturday 14 Nov: "จันทร์หน้า" is the Monday right after
  const sat = new Date(2026, 10, 14, 9).getTime();
  assert.deepEqual(when('จันทร์หน้า ประชุม', sat), ['ประชุม', '2026-11-16', null]);
  assert.deepEqual(when('วันเสาร์', sat), ['วันเสาร์', '2026-11-14', null]);
});

test('Thai clock times', () => {
  assert.deepEqual(when('พรุ่งนี้ 5 โมงเย็น โทรหาแม่'), ['โทรหาแม่', '2026-11-09', '17:00']);
  assert.deepEqual(when('โทรหาแม่พรุ่งนี้5โมงเย็น'), ['โทรหาแม่', '2026-11-09', '17:00']);
  assert.deepEqual(when('7 โมงเช้า วิ่ง'), ['วิ่ง', '2026-11-09', '07:00']);
  assert.deepEqual(when('สิบเอ็ดโมง ส่งของ'), ['ส่งของ', '2026-11-08', '11:00']);
  assert.deepEqual(when('บ่ายโมง กินข้าว'), ['กินข้าว', '2026-11-08', '13:00']);
  assert.deepEqual(when('บ่ายสองครึ่ง ประชุมทีม'), ['ประชุมทีม', '2026-11-08', '14:30']);
  assert.deepEqual(when('บ่าย 3 โมง ประชุม'), ['ประชุม', '2026-11-08', '15:00']);
  assert.deepEqual(when('ห้าโมงครึ่ง รับลูก'), ['รับลูก', '2026-11-08', '17:30']);
  assert.deepEqual(when('สองทุ่ม ดูบอล'), ['ดูบอล', '2026-11-08', '20:00']);
  assert.deepEqual(when('ทุ่มนึง กินข้าว'), ['กินข้าว', '2026-11-08', '19:00']);
  assert.deepEqual(when('3 ทุ่มครึ่ง นอน'), ['นอน', '2026-11-08', '21:30']);
  assert.deepEqual(when('ตี 5 ตื่น'), ['ตื่น', '2026-11-09', '05:00']);
  assert.deepEqual(when('เที่ยง กินข้าว'), ['กินข้าว', '2026-11-08', '12:00']);
  assert.deepEqual(when('๑๐ โมง ประชุม'), ['ประชุม', '2026-11-08', '10:00']);
  // bare "N โมง": 6–11 morning, 1–5 afternoon
  assert.deepEqual(when('3 โมง ประชุม'), ['ประชุม', '2026-11-08', '15:00']);
  assert.deepEqual(when('9 โมง ประชุม'), ['ประชุม', '2026-11-09', '09:00']);
  // the part of day decides
  assert.deepEqual(when('พรุ่งนี้เย็น 6 โมง วิ่ง'), ['วิ่ง', '2026-11-09', '18:00']);
  assert.deepEqual(when('ตอนเย็น 6 โมง วิ่ง'), ['วิ่ง', '2026-11-08', '18:00']);
  assert.deepEqual(when('คืนนี้ 4 ทุ่ม โทรหาแฟน'), ['โทรหาแฟน', '2026-11-08', '22:00']);
  assert.deepEqual(when('จองโรงแรม พรุ่งนี้ บ่ายสอง'), ['จองโรงแรม', '2026-11-09', '14:00']);
  assert.deepEqual(when('พรุ่งนี้บ่าย 3 โมง ประชุม'), ['ประชุม', '2026-11-09', '15:00']);
  assert.deepEqual(when('พรุ่งนี้บ่าย ประชุม'), ['ประชุม', '2026-11-09', null]);
  assert.deepEqual(when('ตอนบ่ายสอง ประชุม'), ['ประชุม', '2026-11-08', '14:00']);
  assert.deepEqual(when('ประชุมตอนบ่ายสอง'), ['ประชุม', '2026-11-08', '14:00']);
  assert.deepEqual(when('ตอนเย็นหกโมงครึ่ง วิ่ง'), ['วิ่ง', '2026-11-08', '18:30']);
  assert.deepEqual(when('ทวนขั้นตอนบ่ายสอง'), ['ทวนขั้นตอน', '2026-11-08', '14:00']);
});

test('digital times', () => {
  assert.deepEqual(when('17:00 นัดหมอ'), ['นัดหมอ', '2026-11-08', '17:00']);
  assert.deepEqual(when('ประชุม 17.00 น.'), ['ประชุม', '2026-11-08', '17:00']);
  assert.deepEqual(when('ประชุมเวลา 9.30'), ['ประชุม', '2026-11-09', '09:30']);
  assert.deepEqual(when('ประชุม ตอน 14:15'), ['ประชุม', '2026-11-08', '14:15']);
  assert.deepEqual(when('call mom tomorrow at 5pm'), ['call mom', '2026-11-09', '17:00']);
  assert.deepEqual(when('gym 6:30am'), ['gym', '2026-11-09', '06:30']);
  assert.deepEqual(when('ส่งรายงาน 17 นาฬิกา'), ['ส่งรายงาน', '2026-11-08', '17:00']);
  // a time already past today goes to tomorrow
  assert.deepEqual(when('8:00 ประชุม'), ['ประชุม', '2026-11-09', '08:00']);
});

test('in N minutes / hours', () => {
  assert.deepEqual(when('อีก 30 นาที ปิดเตา'), ['ปิดเตา', '2026-11-08', '10:30']);
  assert.deepEqual(when('อีกครึ่งชั่วโมง เอาผ้าออก'), ['เอาผ้าออก', '2026-11-08', '10:30']);
  assert.deepEqual(when('อีก 1 ชั่วโมงครึ่ง ออกจากบ้าน'), ['ออกจากบ้าน', '2026-11-08', '11:30']);
  const late = new Date(2026, 10, 8, 23, 40).getTime();
  assert.deepEqual(when('อีก 30 นาที นอน', late), ['นอน', '2026-11-09', '00:10']);
});

test('calendar dates', () => {
  assert.deepEqual(when('ประชุม 15/11 10:30'), ['ประชุม', '2026-11-15', '10:30']);
  assert.deepEqual(when('จ่ายค่าไฟ 15 พ.ย.'), ['จ่ายค่าไฟ', '2026-11-15', null]);
  assert.deepEqual(when('สอบ 15 พฤศจิกายน'), ['สอบ', '2026-11-15', null]);
  assert.deepEqual(when('นัดหมอ 3 ธค 69 9 โมง'), ['นัดหมอ', '2026-12-03', '09:00']);
  assert.deepEqual(when('นัดหมอ 3 ธ.ค. 9:30'), ['นัดหมอ', '2026-12-03', '09:30']);
  assert.deepEqual(when('ต่อพาสปอร์ต 2/1/2570'), ['ต่อพาสปอร์ต', '2027-01-02', null]);
  assert.deepEqual(when('ต่อพาสปอร์ต 2/1/27'), ['ต่อพาสปอร์ต', '2027-01-02', null]);
  // already passed this year → next year
  assert.deepEqual(when('วันเกิดแม่ 3 มี.ค.'), ['วันเกิดแม่', '2027-03-03', null]);
  assert.deepEqual(when('จ่ายบัตร วันที่ 25'), ['จ่ายบัตร', '2026-11-25', null]);
  assert.deepEqual(when('จ่ายบัตร วันที่ 5'), ['จ่ายบัตร', '2026-12-05', null]);
  // impossible dates are left alone
  assert.deepEqual(when('31/2 อะไรสักอย่าง'), ['31/2 อะไรสักอย่าง', null, null]);
});

test('only a date phrase: keeps the words as the text', () => {
  assert.deepEqual(when('พรุ่งนี้'), ['พรุ่งนี้', '2026-11-09', null]);
});

test('repeats', async () => {
  const { nextOccurrence, repeatLabel, isRepeat } = await import('../src/lib/dates.js');
  const r = (s) => {
    const p = parseWhen(s, NOW);
    return [p.text, p.day, p.time, p.repeat];
  };
  assert.deepEqual(r('ทุกวัน 8 โมง กินยา'), ['กินยา', '2026-11-09', '08:00', 'daily']); // 8:00 has passed today
  assert.deepEqual(r('กินยาทุกวันสองทุ่ม'), ['กินยา', '2026-11-08', '20:00', 'daily']);
  assert.deepEqual(r('ทุกวันจันทร์ ทิ้งขยะ'), ['ทิ้งขยะ', '2026-11-09', null, 'weekly:1']);
  assert.deepEqual(r('ทุกจันทร์ ทิ้งขยะ'), ['ทิ้งขยะ', '2026-11-09', null, 'weekly:1']);
  assert.deepEqual(r('ทุกวันอาทิตย์ ไปวัด'), ['ไปวัด', '2026-11-08', null, 'weekly:0']);
  assert.deepEqual(r('ทุกอาทิตย์ ล้างรถ'), ['ล้างรถ', '2026-11-08', null, 'weekly:0']); // every week, from today
  assert.deepEqual(r('จ่ายบัตร ทุกวันที่ 25'), ['จ่ายบัตร', '2026-11-25', null, 'monthly:25']);
  assert.deepEqual(r('ทุกเดือนวันที่ 31 จ่ายค่าเช่า'), ['จ่ายค่าเช่า', '2026-11-30', null, 'monthly:31']);
  assert.deepEqual(r('ทุกวันทำงาน 7 โมง ตื่น'), ['ตื่น', '2026-11-09', '07:00', 'weekdays']);
  assert.deepEqual(r('วันเกิดแม่ 3 มี.ค. ทุกปี'), ['วันเกิดแม่', '2027-03-03', null, 'yearly']);
  assert.deepEqual(r('ทุกสัปดาห์ วันศุกร์ ส่งรายงาน'), ['ส่งรายงาน', '2026-11-13', null, 'weekly:5']);
  assert.equal(parseWhen('ซื้อนม', NOW).repeat, null);

  assert.equal(nextOccurrence('daily', '2026-11-08'), '2026-11-09');
  assert.equal(nextOccurrence('weekdays', '2026-11-13'), '2026-11-16');
  assert.equal(nextOccurrence('weekly:1', '2026-11-09'), '2026-11-16');
  assert.equal(nextOccurrence('monthly:31', '2026-11-30'), '2026-12-31');
  assert.equal(nextOccurrence('monthly:31', '2027-01-31'), '2027-02-28');
  assert.equal(nextOccurrence('yearly', '2028-02-29'), '2029-02-28');
  assert.equal(repeatLabel('weekly:1'), 'ทุกวันจันทร์');
  assert.equal(repeatLabel('monthly:25'), 'ทุกวันที่ 25');
  assert.ok(isRepeat('monthly:31') && !isRepeat('monthly:32') && !isRepeat('hourly'));
});
