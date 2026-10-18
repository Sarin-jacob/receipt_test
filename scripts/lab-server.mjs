#!/usr/bin/env node
// Local server for the bench: serves the repo as-is, and lets bench/fixtures.html save OCR
// output to fixtures/ocr/<dataset>/<image>.json (git-ignored), so scripts/score.mjs can score
// the solver in Node without re-running OCR.
//   node scripts/lab-server.mjs [--port 8765]   then open http://localhost:8765/bench/fixtures.html
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, resolve, sep, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures', 'ocr');
const { values: opt } = parseArgs({ options: { port: { type: 'string', default: '8765' } } });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const inside = (base, f) => f === base || f.startsWith(base + sep);

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (req.method === 'PUT' && path.startsWith('/__fixtures/')) {
    const file = resolve(FIXTURES, '.' + path.slice('/__fixtures'.length));
    if (!inside(FIXTURES, file) || !file.endsWith('.json')) return res.writeHead(403).end();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat(chunks));
      res.writeHead(204).end();
    });
    return;
  }
  let file = resolve(ROOT, '.' + path);
  if (!inside(ROOT, file)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(+opt.port, '127.0.0.1', () => console.log(`lab: http://localhost:${opt.port}/bench/fixtures.html`));
