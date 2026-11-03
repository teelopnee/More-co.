// Copies the OCR engine (Tesseract) and Thai/English language data into
// public/ocr so the app reads slips fully offline, without any CDN.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['relaxedsimd-lstm', 'simd-lstm', 'lstm'].map((v) => [
    join(pkgDir('tesseract.js-core'), `tesseract-core-${v}.wasm.js`),
    join('core', `tesseract-core-${v}.wasm.js`),
  ]),
  ...['tha', 'eng'].map((lang) => [
    join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`),
    join('lang', `${lang}.traineddata.gz`),
  ]),
];

for (const [src, rel] of files) {
  if (!existsSync(src)) {
    console.error(`[copy-ocr-assets] missing ${src}`);
    process.exit(1);
  }
  const dest = join(out, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
console.log(`[copy-ocr-assets] copied ${files.length} files to public/ocr`);
