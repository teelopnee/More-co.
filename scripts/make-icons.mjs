// Renders the app icon SVG into the PNG sizes the PWA manifest and iOS need.
// Usage: node scripts/make-icons.mjs   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const art = (scale = 1) => {
  const t = (256 * (1 - scale)).toFixed(1);
  return `<g transform="translate(${t} ${t}) scale(${scale})">
    <path d="M150 92h212a14 14 0 0 1 14 14v300l-29-19-29 19-29-19-29 19-29-19-29 19-29-19-29 19V106a14 14 0 0 1 14-14z" fill="#ffffff"/>
    <rect x="186" y="152" width="140" height="24" rx="12" fill="#c7c8f4"/>
    <rect x="186" y="204" width="96" height="24" rx="12" fill="#c7c8f4"/>
    <rect x="186" y="266" width="120" height="34" rx="12" fill="#4338ca"/>
    <circle cx="358" cy="368" r="78" fill="#10b981" stroke="#3b34b8" stroke-width="18"/>
    <path d="m322 368 25 25 47-50" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b52f0"/><stop offset="1" stop-color="#3730a3"/></linearGradient></defs>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" rx="116" fill="url(#g)"/>${art(1)}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#g)"/>${art(0.74)}</svg>`;
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#g)"/>${art(0.86)}</svg>`;

writeFileSync(join(out, 'favicon.svg'), icon);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, svg, size] of [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', apple, 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written to', out);
