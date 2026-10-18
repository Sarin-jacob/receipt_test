#!/usr/bin/env node
// Scores the line solver on saved OCR output (fixtures/ocr/, made by bench/fixtures.html), in
// seconds and without a browser, so solver changes can be checked on every dataset.
//   node scripts/score.mjs                     summary per dataset
//   node scripts/score.mjs apps --rows         one line per receipt
//   node scripts/score.mjs --save              remember the scores as the baseline
//   node scripts/score.mjs --diff              what changed since the baseline (per receipt)
//   node scripts/score.mjs --show apps:3       one receipt: OCR lines, ground truth vs output
//   --fixtures <dir> / --baseline <file>      score other OCR output / compare with another baseline
import { register } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

register(new URL('./cdn-stub-loader.mjs', import.meta.url));
const { solveReceipt } = await import('../bench/lib/solver.js');
const { normalize } = await import('../bench/lib/schema.js');
const { score } = await import('../bench/lib/score.js');
const { audit } = await import('../bench/lib/audit.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let FIX = join(ROOT, 'fixtures', 'ocr');
let BASELINE = join(ROOT, 'fixtures', 'baseline.json');
// Keep in sync with bench/fixtures.html.
const DATASETS = {
  dev: 'reciepts',
  sroie: 'datasets/sroie40',
  final: 'datasets/sroie-final40',
  mine: 'reciepts-uploaded/reciepts',
  web: 'datasets/web',
  apps: 'datasets/apps',
};

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rows: { type: 'boolean' }, save: { type: 'boolean' }, diff: { type: 'boolean' }, show: { type: 'string' },
    fixtures: { type: 'string' }, // another OCR output folder (e.g. before a preprocessing change)
    baseline: { type: 'string' }, // another baseline file
  },
});
if (opt.fixtures) FIX = resolve(ROOT, opt.fixtures);
if (opt.baseline) BASELINE = resolve(ROOT, opt.baseline);

const gtOf = (ds) => JSON.parse(readFileSync(join(ROOT, DATASETS[ds], 'ground_truth.json'), 'utf8')).receipts;
function boxesOf(ds, file) {
  const f = join(FIX, ds, `${file}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return Object.assign(j.boxes, { skewDeg: j.skewDeg, info: j.info });
}

function evaluate(ds) {
  const out = [];
  for (const [i, g] of gtOf(ds).entries()) {
    const boxes = boxesOf(ds, g.file);
    if (!boxes) continue;
    const { _lines, _debug, ...raw } = solveReceipt(boxes);
    const p = normalize(raw);
    out.push({ i, file: g.file, g, p, lines: _lines, sc: score(g, p), a: audit(p) });
  }
  return out;
}

function summary(ds, rs) {
  if (!rs.length) return null;
  const s = rs.reduce((t, r) => t + r.sc.score, 0) / rs.length;
  const tot = rs.filter((r) => r.sc.fields.total);
  const sub = rs.filter((r) => r.sc.fields.subtotal);
  const it = rs.filter((r) => r.sc.fields.items);
  const items = it.reduce((t, r) => ({ m: t.m + r.sc.fields.items.matched, g: t.g + r.sc.fields.items.gt, p: t.p + r.sc.fields.items.pred }), { m: 0, g: 0, p: 0 });
  const self = rs.filter((r) => r.a.ok);
  return {
    ds, n: rs.length, score: +s.toFixed(3),
    totals: `${tot.filter((r) => r.sc.fields.total.ok).length}/${tot.length}`,
    subtotals: `${sub.filter((r) => r.sc.fields.subtotal.ok).length}/${sub.length}`,
    items: it.length ? `${items.m}/${items.g} (pred ${items.p})` : '-',
    selfcheck: `${self.length} (${self.filter((r) => r.sc.fields.total?.ok).length} right)`,
  };
}

const row = (r) => {
  const f = r.sc.fields;
  return `${String(r.i).padStart(2)} ${String(Math.round(r.sc.score * 100)).padStart(3)}  T:${f.total ? (f.total.ok ? 'ok' : `X ${r.p.total}/${r.g.total}`) : '-'}` +
    `  S:${f.subtotal ? (f.subtotal.ok ? 'ok' : `X ${r.p.subtotal}/${r.g.subtotal}`) : '-'}` +
    `  items ${f.items ? `${f.items.matched}/${f.items.gt} pred ${f.items.pred}` : '-'}  self ${r.a.ok ? '✓' : '✗'}  ${r.file}`;
};

if (opt.show) {
  const [ds, idx] = opt.show.split(':');
  const r = evaluate(ds).find((x) => x.i === +idx);
  if (!r) throw new Error(`no fixture for ${opt.show}`);
  const fmt = (x) => `${x.name} | q${x.qty ?? '-'} × ${x.unit_price ?? '-'} = ${x.total}`;
  console.log(r.lines, '\n');
  console.log(`GT  (${r.g.items.length}):\n  ${r.g.items.map(fmt).join('\n  ')}`);
  console.log(`OUT (${r.p.items.length}):\n  ${r.p.items.map(fmt).join('\n  ')}`);
  console.log(`subtotal ${r.p.subtotal} (gt ${r.g.subtotal})  total ${r.p.total} (gt ${r.g.total})  merchant ${JSON.stringify(r.p.merchant)} (gt ${JSON.stringify(r.g.merchant.name)})`);
  console.log(`charges ${JSON.stringify(r.p.charges)}\ndiscounts ${JSON.stringify(r.p.discounts)}\ntaxes ${JSON.stringify(r.p.taxes)}`);
  console.log('checks', r.a.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`));
  process.exit(0);
}

const want = positionals.length ? positionals : Object.keys(DATASETS).filter((ds) => existsSync(join(FIX, ds)) && readdirSync(join(FIX, ds)).length);
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const save = {};
const table = [];
for (const ds of want) {
  const rs = evaluate(ds);
  const s = summary(ds, rs);
  if (!s) continue;
  table.push({ ...s, was: base[ds]?.score ?? '' });
  save[ds] = { score: s.score, receipts: Object.fromEntries(rs.map((r) => [r.file, r.sc.score])) };
  if (opt.rows) {
    console.log(`\n${ds}`);
    rs.forEach((r) => console.log(row(r)));
  }
  if (opt.diff && base[ds]) {
    for (const r of rs) {
      const before = base[ds].receipts[r.file];
      if (before != null && Math.abs(before - r.sc.score) > 0.0005) console.log(`${r.sc.score > before ? '+' : '-'} ${ds} ${before} → ${r.sc.score}  ${row(r)}`);
    }
  }
}
console.table(table);
if (opt.save) {
  writeFileSync(BASELINE, JSON.stringify({ ...base, ...save }, null, 1));
  console.log(`baseline saved: ${Object.keys(save).join(', ')}`);
}
