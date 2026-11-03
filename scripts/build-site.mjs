#!/usr/bin/env node
// Builds every app in apps/ into one site (_site/) with a home page that links to all of them.
//
//   node scripts/build-site.mjs                 install, test and build every app
//   node scripts/build-site.mjs --skip-tests    build only
//   node scripts/build-site.mjs --only=jodwai   just these apps (comma separated)
//
// An app is any folder in apps/:
//   - with package.json: `npm ci` (or `npm install`), `npm test` if it has one, `npm run build`,
//     then the build output (dist/ unless app.json says otherwise) is published
//   - without package.json: the folder is published as-is (plain HTML/JS)
// Optional apps/<name>/app.json: { "title", "description", "output", "icon" }.
// Otherwise the title is the README's first heading and the description its first paragraph.

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
const out = join(root, args.find((a) => a.startsWith('--out='))?.slice(6) ?? '_site');
const ci = !!process.env.GITHUB_ACTIONS;

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function group(title, fn) {
  if (ci) console.log(`::group::${title}`);
  else console.log(`\n── ${title}`);
  try {
    return fn();
  } finally {
    if (ci) console.log('::endgroup::');
  }
}

function run(cmd, cmdArgs, cwd, app) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    const msg = `${app}: "${cmd} ${cmdArgs.join(' ')}" ไม่ผ่าน (exit ${r.status ?? r.signal})`;
    console.error(ci ? `::error::${msg}` : `\n✖ ${msg}`);
    process.exit(1);
  }
}

/** Title and description from app.json, else README heading + first paragraph. */
function describe(dir, name) {
  const meta = readJson(join(dir, 'app.json'));
  const readme = existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : '';
  const heading = readme.match(/^#\s+(.+)$/m)?.[1].trim();
  const para = readme
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|\||```|-|\*|>|<)/.test(p));
  const plain = (s) => s?.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  let description = meta.description ?? plain(para) ?? readJson(join(dir, 'package.json')).description ?? '';
  if (description.length > 180) description = description.slice(0, 177).replace(/\s+\S*$/, '') + '…';
  return { title: meta.title ?? heading ?? name, description, output: meta.output, icon: meta.icon };
}

function buildApp(name) {
  const dir = join(root, 'apps', name);
  const info = describe(dir, name);
  const pkg = readJson(join(dir, 'package.json'));
  const dest = join(out, name);
  group(`${name} — ${info.title}`, () => {
    if (existsSync(join(dir, 'package.json'))) {
      run('npm', [existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], dir, name);
      if (!skipTests && pkg.scripts?.test) run('npm', ['test'], dir, name);
      if (pkg.scripts?.build) {
        run('npm', ['run', 'build'], dir, name);
        const built = join(dir, info.output ?? 'dist');
        if (!existsSync(built)) {
          console.error(`${name}: ไม่เจอโฟลเดอร์ผลลัพธ์ ${built} (ตั้ง "output" ใน app.json ได้)`);
          process.exit(1);
        }
        cpSync(built, dest, { recursive: true });
        return;
      }
    }
    cpSync(dir, dest, {
      recursive: true,
      filter: (src) => !/(^|[\\/])(node_modules|\.[^\\/]+)$/.test(src.slice(dir.length)),
    });
  });
  const icon =
    info.icon ?? ['icons/icon-192.png', 'icons/favicon.svg', 'favicon.svg', 'icon.png'].find((p) => existsSync(join(dest, p)));
  return { name, ...info, icon };
}

function repoUrl() {
  if (process.env.GITHUB_REPOSITORY) return `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`;
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' });
  const m = r.stdout?.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

function listDocs() {
  const dir = join(root, 'docs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ file: f, title: readFileSync(join(dir, f), 'utf8').match(/^#\s+(.+)$/m)?.[1].trim() ?? basename(f, '.md') }));
}

function homePage(apps, docs) {
  const repo = repoUrl();
  const sha = (process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim().slice(0, 7);
  const when = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  const card = (a) => `
      <a class="card" href="./${encodeURI(a.name)}/">
        ${a.icon ? `<img src="./${encodeURI(a.name)}/${esc(a.icon)}" alt="" width="56" height="56">` : `<span class="mono">${esc([...a.title][0])}</span>`}
        <span class="text"><strong>${esc(a.title)}</strong><span>${esc(a.description)}</span></span>
      </a>`;
  const doc = (d) => `<li><a href="${repo}/blob/main/docs/${encodeURI(d.file)}">${esc(d.title)}</a></li>`;
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>More-co. — ทุกแอป</title>
<meta name="color-scheme" content="light dark">
<style>
:root { --bg: #f5f6fa; --card: #fff; --ink: #1a1c25; --dim: #5d6273; --line: #e3e5ee; --accent: #4338ca; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1117; --card: #181b24; --ink: #eceef5; --dim: #9aa0b4; --line: #2a2e3b; --accent: #a5b4fc; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 "IBM Plex Sans Thai", "Noto Sans Thai", "Leelawadee UI", system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 40px 16px 56px; }
h1 { margin: 0 0 4px; font-size: 28px; }
h2 { margin: 36px 0 12px; font-size: 15px; letter-spacing: .04em; color: var(--dim); font-weight: 600; }
p.lede { margin: 0; color: var(--dim); }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); }
.card { display: flex; gap: 14px; align-items: flex-start; padding: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; color: inherit; text-decoration: none; transition: border-color .15s, transform .15s; }
.card:hover, .card:focus-visible { border-color: var(--accent); transform: translateY(-1px); outline: none; }
.card img, .mono { flex: none; width: 56px; height: 56px; border-radius: 14px; }
.mono { display: grid; place-items: center; background: var(--accent); color: var(--card); font-size: 26px; font-weight: 600; }
.text { display: grid; gap: 2px; min-width: 0; }
.text span { color: var(--dim); font-size: 14px; }
ul { margin: 0; padding-left: 20px; }
a { color: var(--accent); }
footer { margin-top: 40px; color: var(--dim); font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>More-co.</h1>
  <p class="lede">ทุกแอปในที่เดียว เปิดได้จากทุกเครื่อง อัปเดตเองทุกครั้งที่มีการแก้ไข</p>
  <h2>แอป</h2>
  <div class="grid">${apps.map(card).join('')}
  </div>
  ${docs.length && repo ? `<h2>เอกสาร</h2>\n  <ul>${docs.map(doc).join('')}</ul>` : ''}
  <footer>อัปเดตล่าสุด ${esc(when)}${sha ? ` · <a href="${repo ?? '#'}/commit/${sha}">${sha}</a>` : ''}${repo ? ` · <a href="${repo}">ซอร์สโค้ด</a>` : ''}</footer>
</main>
</body>
</html>
`;
}

const appsDir = join(root, 'apps');
const names = readdirSync(appsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .filter((n) => !only || only.includes(n))
  .sort();
if (!names.length) {
  console.error('ไม่เจอแอปใน apps/');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const apps = names.map(buildApp);
const docs = listDocs();
writeFileSync(join(out, 'index.html'), homePage(apps, docs));

const lines = apps.map((a) => `- **${a.title}** → \`/${a.name}/\``);
console.log(`\n✔ สร้างเว็บรวม ${apps.length} แอปไว้ที่ ${basename(out)}/\n${lines.join('\n')}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### สร้างครบ ${apps.length} แอป${skipTests ? '' : ' (ทดสอบผ่าน)'}\n${lines.join('\n')}\n`);
}
