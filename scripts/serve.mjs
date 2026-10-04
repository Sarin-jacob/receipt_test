#!/usr/bin/env node
// Builds both channels the way gh-pages lays them out (stable at /, beta at
// /beta/) and serves them locally.
//   node scripts/serve.mjs [--port 8770] [--no-build]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, CHANNELS, build } from './build.mjs';

const { values: opt } = parseArgs({ options: { port: { type: 'string', default: '8770' }, 'no-build': { type: 'boolean', default: false } } });
const DIR = join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

if (!opt['no-build']) {
  // Stable first: it builds into dist/ itself, which clears the folder.
  for (const [channel, cfg] of Object.entries(CHANNELS).sort(([, a], [, b]) => a.path.length - b.path.length)) {
    const r = build({ channel, out: join(DIR, cfg.path) });
    console.log(`built ${channel} v${r.version} → dist/${cfg.path}`);
  }
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = resolve(DIR, '.' + path);
  if (file !== DIR && !file.startsWith(DIR + sep)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' }).end(); return; }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(+opt.port, '127.0.0.1', () => {
  console.log(`\nstable: http://localhost:${opt.port}/\nbeta:   http://localhost:${opt.port}/beta/`);
});
