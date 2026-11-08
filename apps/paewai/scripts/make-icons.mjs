#!/usr/bin/env node
// Renders the PNG app icons from the SVGs. Needs Playwright (not a dependency of the app):
//   node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// require() also finds a globally installed Playwright, which ESM import does not.
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'src', 'icons');
const any = readFileSync(join(icons, 'favicon.svg'), 'utf8');
const maskable = readFileSync(join(root, 'scripts', 'icon-maskable.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, svg, size, bg] of [
  ['icon-192.png', any, 192, 'transparent'],
  ['icon-512.png', any, 512, 'transparent'],
  ['icon-maskable-512.png', maskable, 512, '#2b2a5c'],
  // iPhone home screen: full-bleed, iOS rounds the corners itself
  ['apple-touch-icon.png', maskable, 180, '#2b2a5c'],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:${bg}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(icons, name), omitBackground: bg === 'transparent' });
  console.log(name);
}
await browser.close();
