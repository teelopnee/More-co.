// Runs the real OCR engine on the synthetic slips in tests/fixtures/slips and
// checks the parser end to end (QR is decoded in the browser; here we pass the
// known QR payload so only OCR + parsing is under test).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { guessDirection, parseSlip } from '../../src/slip/parse';
import { toOcrLines } from '../../src/slip/ocrLines';
import { OCR_PARAMS } from '../../src/slip/ocrConfig';
import { fuzzyIncludes } from '../../src/slip/text';

const dir = join(__dirname, '..', 'fixtures', 'slips');
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Array<Record<string, any>>;

let worker: Worker;
beforeAll(async () => {
  worker = await createWorker(['tha', 'eng'], 1, { langPath: join(__dirname, '..', '..', 'public', 'ocr', 'lang'), cacheMethod: 'none' });
  await worker.setParameters({ ...OCR_PARAMS, tessedit_pageseg_mode: PSM.AUTO });
}, 60_000);
afterAll(async () => worker?.terminate());

describe('synthetic slips (real OCR)', () => {
  for (const exp of expected) {
    it(exp.file, async () => {
      const { data } = await worker.recognize(join(dir, exp.file), {}, { blocks: true, text: true });
      const slip = parseSlip(toOcrLines(data.blocks as any, data.text), exp.qr);
      if (exp.notSlip) {
        expect(slip.isSlip).toBe(false);
        return;
      }
      expect(slip.isSlip).toBe(true);
      expect(slip.amount).toBe(exp.amount);
      expect(slip.date).toBe(exp.date);
      expect(slip.time).toBe(exp.time);
      // Names: OCR may drop tone marks or garble a word, so compare loosely.
      if (exp.from) expect(fuzzyIncludes(slip.from ?? '', exp.from), `from: ${slip.from}`).toBe(true);
      if (exp.to) expect(fuzzyIncludes(slip.to ?? '', exp.to), `to: ${slip.to}`).toBe(true);
      if (exp.memo) expect(slip.memo).toBe(exp.memo);
      if (exp.qr || /^[0-9A-Z]+$/.test(exp.ref ?? '')) expect(slip.ref).toBe(exp.ref);
      if (exp.bank) expect(slip.bank?.id).toBe(exp.bank);
      expect(guessDirection(slip, ['ธนพล', 'THANAPHON'])).toBe(exp.income ? 'income' : 'expense');
    }, 30_000);
  }
});
