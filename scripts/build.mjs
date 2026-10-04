#!/usr/bin/env node
// Builds the scanner into a static site for GitHub Pages.
//   node scripts/build.mjs [--channel beta|stable] [--out dist]
// Copies scan/ plus the bench/lib modules it imports (found by following the
// imports), versions every module URL (?v=<build>) so a deploy never mixes old
// and new files, and adds the PWA parts: manifest, icons and a service worker
// that keeps the app and the downloaded OCR model working offline.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { pngIcon, svgIcon } from './icons.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'scan/scan.js', PAGE = 'scan/index.html';
const THEME = '#3557d6', BACKGROUND = '#f6f7f9';
const DESCRIPTION = 'Scan a receipt and get its items, totals, taxes, date and GST details. Runs on your device; photos are never uploaded.';

// Release channels share the gh-pages branch; `path` is where each one lives.
export const CHANNELS = {
  stable: { path: '', name: 'Receipt Scan', shortName: 'Receipts', link: { href: 'beta/', text: 'Try the beta' }, redirects: ['scan/'] },
  beta: { path: 'beta/', name: 'Receipt Scan (beta)', shortName: 'Receipts β', link: { href: '../', text: 'Back to stable' }, redirects: [] },
};

// Cross-origin files the service worker keeps after first use: the OCR library
// and ONNX runtime (version-pinned jsDelivr URLs) and the PaddleOCR models.
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'paddle-model-ecology.bj.bcebos.com'];

export function git(...args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// package.json holds the release version. A clean checkout of its tag builds as
// "1.2.0"; later commits as "1.2.0+3.abc1234" (3 commits past the last tag);
// uncommitted edits add ".dirty".
export function versionInfo() {
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const commit = git('rev-parse', '--short', 'HEAD') || 'nogit';
  const dirty = !!git('status', '--porcelain', '--untracked-files=no');
  const tag = git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*', 'HEAD');
  const last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
  const ahead = last ? git('rev-list', '--count', `${last}..HEAD`) : 'dev';
  const released = tag === `v${pkgVersion}` && !dirty;
  const version = released ? pkgVersion : `${pkgVersion}+${ahead}.${commit}${dirty ? '.dirty' : ''}`;
  const build = dirty ? `${commit}-${Date.now().toString(36)}` : commit;
  // Commit time, not build time, so rebuilding a commit gives identical files.
  const date = dirty ? new Date().toISOString() : git('log', '-1', '--format=%cI') || new Date().toISOString();
  return { version, pkgVersion, commit, tag, dirty, released, build, date };
}

const read = f => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)\2/g;
const resolveSpec = (src, spec) => posix.normalize(posix.join(posix.dirname(src), spec));

// Files under scan/ keep their place; shared modules (bench/lib/…) go to lib/.
function collectModules(entry) {
  const mods = new Map(), queue = [entry];
  while (queue.length) {
    const src = queue.shift();
    if (mods.has(src)) continue;
    const out = src.startsWith('scan/') ? src.slice('scan/'.length) : 'lib/' + posix.basename(src);
    if ([...mods.values()].includes(out)) throw new Error(`build: two modules would both become ${out}`);
    mods.set(src, out);
    for (const m of read(src).matchAll(IMPORT)) queue.push(resolveSpec(src, m[3]));
  }
  return mods;
}

// Replaces exactly once, so a change to the page's markup fails the build
// instead of silently dropping the manifest or service worker.
function replaceOnce(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`build: expected one ${JSON.stringify(from)} in ${PAGE}, found ${n}`);
  return text.replace(from, () => to);
}

export function build({ channel = 'beta', out = join(ROOT, 'dist') } = {}) {
  const cfg = CHANNELS[channel];
  if (!cfg) throw new Error(`build: unknown channel "${channel}" (${Object.keys(CHANNELS).join(', ')})`);
  const info = versionInfo();
  const app = { name: cfg.name, version: info.version, channel, commit: info.commit, date: info.date };
  const v = `?v=${info.build}`;
  const notice = read('LICENSE').match(/^Required Notice:.*$/m)?.[0];
  if (!notice) throw new Error('build: LICENSE has no "Required Notice:" line');
  const banner = `/*! ${cfg.name} v${info.version} | PolyForm Noncommercial 1.0.0, see LICENSE.txt | ${notice} */\n`;

  rmSync(out, { recursive: true, force: true });
  const files = [];
  const write = (name, data) => {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), data);
    files.push(name);
  };

  // Modules, with relative imports pointed at their new place and versioned.
  const mods = collectModules(ENTRY);
  for (const [src, dest] of mods) {
    const code = read(src).replace(IMPORT, (m, pre, q, spec) => {
      let rel = posix.relative(posix.dirname(dest), mods.get(resolveSpec(src, spec)));
      if (!rel.startsWith('.')) rel = './' + rel;
      return `${pre}${q}${rel}${v}${q}`;
    });
    write(dest, banner + code);
  }

  const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
  let html = read(PAGE);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${cfg.name}</title>`);
  html = replaceOnce(html, 'src="scan.js"', `src="scan.js${v}"`);
  html = replaceOnce(html, 'href="../LICENSE"', 'href="LICENSE.txt"');
  html = replaceOnce(html, '</head>', `  <meta name="description" content="${DESCRIPTION}" />
  <meta name="theme-color" content="${THEME}" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" href="icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="icon-192.png" />
</head>`);
  html = replaceOnce(html, '</body>', `  <script>
    window.APP = ${json(app)};
    (function () {
      var v = document.getElementById('appVersion'), o = document.getElementById('appChannel');
      if (v) v.textContent = 'v' + APP.version + (APP.channel === 'stable' ? '' : ' (' + APP.channel + ')');
      if (o) { o.href = ${json(cfg.link.href)}; o.textContent = ${json(cfg.link.text)}; o.hidden = false; }
      if ('serviceWorker' in navigator) addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
    })();
  </script>
</body>`);
  write('index.html', html);

  write('manifest.webmanifest', JSON.stringify({
    id: './', name: cfg.name, short_name: cfg.shortName, description: DESCRIPTION,
    start_url: './', scope: './', display: 'standalone', background_color: BACKGROUND, theme_color: THEME,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }, null, 2) + '\n');
  write('icon.svg', svgIcon());
  write('icon-192.png', pngIcon(192));
  write('icon-512.png', pngIcon(512));
  write('icon-maskable-512.png', pngIcon(512, { maskable: true }));
  write('LICENSE.txt', read('LICENSE'));
  write('version.json', JSON.stringify(app, null, 2) + '\n');

  // Old address from when Pages served the whole repo (…/scan/).
  for (const dir of cfg.redirects) {
    const up = '../'.repeat(dir.split('/').filter(Boolean).length);
    write(dir + 'index.html', `<!DOCTYPE html><meta charset="utf-8"><title>${cfg.name}</title><meta http-equiv="refresh" content="0; url=${up}"><link rel="canonical" href="${up}"><a href="${up}">${cfg.name} has moved here</a>\n`);
  }

  const modFiles = new Set(mods.values());
  const shell = ['./', ...files.filter(f => !cfg.redirects.some(d => f.startsWith(d))).map(f => modFiles.has(f) ? f + v : f)];
  // Other channels live below this one (beta/ under stable); leave them to their own worker.
  const skip = Object.values(CHANNELS).map(c => c.path).filter(p => p && p !== cfg.path && p.startsWith(cfg.path)).map(p => p.slice(cfg.path.length));
  write('sw.js', serviceWorker({ channel, build: info.build, version: info.version, shell, skip }));

  return { ...info, channel, out, files };
}

// App files: cached at install, served cache-first (their URLs carry the build).
// Pages: network first, cached copy when offline or slow. OCR library, runtime and
// models: cached on first use, shared by all channels (their URLs never change).
function serviceWorker({ channel, build, version, shell, skip }) {
  return `/*! ${channel} v${version} */
const SHELL = ${JSON.stringify(`scan-${channel}-${build}`)};
const OWN = ${JSON.stringify(`scan-${channel}-`)};
const RUNTIME = 'scan-runtime-1';
const FILES = ${JSON.stringify(shell)};
const RUNTIME_HOSTS = ${JSON.stringify(RUNTIME_HOSTS)};
const SKIP = ${JSON.stringify(skip)};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(OWN) && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (SKIP.some(p => path.startsWith(p))) return;
    e.respondWith(req.mode === 'navigate' ? page(req) : appFile(req));
  } else if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(keep(req));
  }
});

async function page(req) {
  const cached = caches.match('./', { cacheName: SHELL });
  try {
    return await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => cached.then(r => r ? reject(new Error('slow')) : null), 4000)),
    ]);
  } catch {
    return (await cached) || Response.error();
  }
}

async function appFile(req) {
  return (await caches.match(req, { cacheName: SHELL })) || fetch(req);
}

async function keep(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200) cache.put(req, res.clone()).catch(() => {});
  return res;
}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'beta' }, out: { type: 'string', default: 'dist' } } });
  const r = build({ channel: values.channel, out: resolve(ROOT, values.out) });
  console.log(`built ${r.channel} v${r.version} → ${relative(ROOT, r.out) || '.'} (${r.files.length} files)`);
}
