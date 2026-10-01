import { ENGINES } from './engines/index.js';
import { OCR_MODELS, getOcr } from './lib/ocr.js';
import { ocrPhoto, toCanvas } from './lib/preprocess.js';
import { normalize } from './lib/schema.js';
import { score } from './lib/score.js';
import { audit } from './lib/audit.js';

// Dev set = the receipts the parsers were tuned on; held-out = never looked at while tuning.
const DATASETS = {
  dev: { label: 'Your receipts (dev, 11)', dir: '../reciepts/' },
  sroie: { label: 'SROIE tuning (40)', dir: '../datasets/sroie40/' },
  final: { label: 'SROIE final test (40, never tune on it)', dir: '../datasets/sroie-final40/' },
  mine: { label: 'Your photos (31, private)', dir: '../reciepts-uploaded/reciepts/' },
};
const dataset = () => DATASETS[$('dataset').value];
const STORE_KEY = 'receipt-bench-results-v1';
const BUDGET_MB = 500;

const $ = id => document.getElementById(id);
const state = { gt: [], results: load(), running: false, stop: false, selected: null };

function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
// Merge with what's stored so two bench tabs don't erase each other's results.
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...load(), ...state.results })); } catch {}
}
// Image-only engines don't depend on the OCR choice.
const usesOcr = id => ENGINES.find(e => e.id === id)?.family !== 'vlm' && id !== 'chrome-nano-image';
const ocrSetting = () => $('prep').value === 'none' ? $('ocrModel').value : `${$('ocrModel').value}+${$('prep').value}`;
const key = (engineId, file) => `${engineId}|${usesOcr(engineId) ? ocrSetting() : '-'}|${file}`;
const status = msg => { $('status').textContent = msg; };

// ---------- setup ----------
async function init() {
  const hasGpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
  $('device').innerHTML = `<option value="webgpu" ${hasGpu ? '' : 'disabled'}>WebGPU${hasGpu ? '' : ' (unavailable)'}</option><option value="wasm">WASM (CPU)</option>`;
  $('device').value = hasGpu ? 'webgpu' : 'wasm';
  $('ocrModel').innerHTML = Object.entries(OCR_MODELS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  const saved = JSON.parse(localStorage.getItem(STORE_KEY + '-sel') || '["rules"]');
  $('engineList').innerHTML = ENGINES.map(e => `
    <label><input type="checkbox" value="${e.id}" ${saved.includes(e.id) ? 'checked' : ''}/> ${e.label}
      <span class="tag ${e.approxMB > BUDGET_MB ? 'over' : ''}">${e.approxMB ? `~${e.approxMB} MB` : 'built-in'}</span>
      <span class="tag">${e.family}</span></label>`).join('');
  $('engineList').addEventListener('change', () => localStorage.setItem(STORE_KEY + '-sel', JSON.stringify(selectedEngines().map(e => e.id))));
  $('ocrModel').addEventListener('change', render);
  $('prep').addEventListener('change', render);

  for (const k of Object.keys(state.results)) { // migrate old keys of image-only engines
    const [id, ocr, file] = k.split('|');
    if (!usesOcr(id) && ocr !== '-') { state.results[`${id}|-|${file}`] ??= state.results[k]; delete state.results[k]; }
  }
  await loadDataset();
  $('dataset').addEventListener('change', async () => { await loadDataset(); render(); });
  $('runBtn').onclick = () => runAll(selectedEngines());
  $('stopBtn').onclick = () => { state.stop = true; status('Stopping after current receipt…'); };
  $('clearBtn').onclick = () => { if (confirm('Clear all stored results?')) { state.results = {}; try { localStorage.removeItem(STORE_KEY); } catch {} render(); } };
  $('exportBtn').onclick = exportResults;
  render();
  status(`Ready. ${state.gt.length} receipts, ${ENGINES.length} engines. WebGPU: ${hasGpu ? 'yes' : 'no'}. Prompt API: ${'LanguageModel' in globalThis ? 'yes' : 'no'}.`);
}

async function loadDataset() {
  state.gt = (await (await fetch(dataset().dir + 'ground_truth.json')).json()).receipts;
}

const selectedEngines = () => [...$('engineList').querySelectorAll('input:checked')].map(i => ENGINES.find(e => e.id === i.value));

// ---------- images ----------
const imageCache = new Map();
async function prepareImage(file) {
  if (imageCache.has(file)) return imageCache.get(file);
  const blob = await (await fetch(dataset().dir + encodeURIComponent(file))).blob();
  const source = await createImageBitmap(blob);
  // canvas: what image-only engines see (upscaled if small, capped at 2400 px).
  const input = { file, blob, source, canvas: toCanvas(source) };
  imageCache.set(file, input);
  return input;
}

// OCR with the selected preprocessing, shared by every OCR-based engine.
const PREP = { none: { crop: false, contrast: false }, crop: { crop: true, contrast: false }, 'crop+contrast': { crop: true, contrast: true } };
const ocrCache = new WeakMap();
function ocrBoxes(input) {
  const k = $('ocrModel').value + '|' + $('prep').value;
  const per = ocrCache.get(input) ?? new Map();
  ocrCache.set(input, per);
  if (!per.has(k)) per.set(k, ocrPhoto(input.source, { ocrModel: $('ocrModel').value, ...PREP[$('prep').value] }).catch(e => { per.delete(k); throw e; }));
  return per.get(k);
}

// ---------- running ----------
function makeCtx(engine) {
  const files = new Map();
  let last = 0;
  return {
    device: $('device').value,
    ocrModel: $('ocrModel').value,
    progress: msg => status(msg),
    ocr: () => { status(`Loading OCR (${OCR_MODELS[$('ocrModel').value].label})…`); return getOcr($('ocrModel').value); },
    ocrBoxes,
    hfProgress: p => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, p);
        if (performance.now() - last < 250) return;
        last = performance.now();
        const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0), total = [...files.values()].reduce((s, f) => s + f.total, 0);
        status(`${engine.label}: downloading ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
      } else if (p.status === 'ready') status(`${engine.label}: initialising…`);
    },
  };
}

async function runEngine(engine, files = state.gt.map(g => g.file)) {
  const ctx = makeCtx(engine);
  const t0 = performance.now();
  try {
    status(`Loading ${engine.label}…`);
    await engine.load(ctx);
  } catch (err) {
    console.error(err);
    for (const f of files) state.results[key(engine.id, f)] = { error: `load: ${err.message}` };
    save(); render();
    return;
  }
  const loadMs = performance.now() - t0;

  for (const file of files) {
    if (state.stop) break;
    const gt = state.gt.find(g => g.file === file);
    const k = key(engine.id, file);
    state.results[k] = { running: true };
    render();
    status(`${engine.label}: ${file}`);
    const input = await prepareImage(file);
    const r0 = performance.now();
    try {
      const out = await engine.run(input, ctx);
      const pred = normalize(out.result);
      state.results[k] = {
        // Cached OCR: charge the original OCR time, not the cache lookup.
        ms: Math.round(performance.now() - r0 - (out.timings?.ocrWait ?? 0) + (out.timings?.ocr ?? 0)), loadMs: Math.round(loadMs),
        pred, raw: typeof out.raw === 'string' ? out.raw : JSON.stringify(out.raw, null, 2),
        ocrText: out.ocrText, timings: out.timings, ...score(gt, pred), audit: audit(pred),
      };
    } catch (err) {
      console.error(engine.id, file, err);
      state.results[k] = { error: err.message, ms: Math.round(performance.now() - r0), raw: err.raw };
    }
    save(); render();
    if (state.selected?.engine === engine.id && state.selected?.file === file) showDetail(engine.id, file);
  }
  try { await engine.unload?.(); } catch {}
}

async function runAll(engines) {
  if (state.running) return;
  state.running = true; state.stop = false;
  $('runBtn').disabled = true; $('stopBtn').disabled = false;
  for (const e of engines) { if (state.stop) break; await runEngine(e); }
  state.running = false;
  $('runBtn').disabled = false; $('stopBtn').disabled = true;
  status(state.stop ? 'Stopped.' : 'Done.');
}

// ---------- rendering ----------
const pct = v => `${Math.round(v * 100)}`;
const cls = v => (v >= 0.85 ? 'g' : v >= 0.5 ? 'm' : 'b');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function engineSummary(e) {
  const rs = state.gt.map(g => state.results[key(e.id, g.file)]).filter(r => r && !r.running);
  const ok = rs.filter(r => !r.error);
  if (!rs.length) return null;
  const mean = f => ok.length ? ok.reduce((s, r) => s + f(r), 0) / rs.length : 0; // errors count as 0
  const audited = ok.filter(r => r.audit?.ok);
  return {
    n: rs.length, errors: rs.length - ok.length,
    score: mean(r => r.score),
    totals: ok.filter(r => r.fields.total?.ok).length,
    items: ok.some(r => r.fields.items) ? ok.filter(r => r.fields.items).reduce((s, r) => s + r.fields.items.value, 0) / rs.filter(r => r.error || r.fields?.items).length : null,
    ms: ok.length ? ok.reduce((s, r) => s + r.ms, 0) / ok.length : 0,
    auditPass: audited.length,
    auditPrecision: audited.length ? audited.filter(r => r.fields.total?.ok).length / audited.length : null,
  };
}

function render() {
  const engines = ENGINES.filter(e => state.gt.some(g => state.results[key(e.id, g.file)]) || selectedEngines().includes(e));
  const head = `<tr><th>Receipt</th><th>Diff.</th>${engines.map(e => `<th class="eng" title="${esc(e.model ?? '')}">${esc(e.label)}</th>`).join('')}</tr>`;
  const rows = state.gt.map(g => `<tr><td>${esc(g.file)}</td><td>${g.difficulty}</td>${engines.map(e => {
    const r = state.results[key(e.id, g.file)];
    if (!r) return `<td class="cell muted" data-e="${e.id}" data-f="${g.file}">·</td>`;
    if (r.running) return `<td class="cell running" data-e="${e.id}" data-f="${g.file}">…</td>`;
    if (r.error) return `<td class="cell b" data-e="${e.id}" data-f="${g.file}" title="${esc(r.error)}">err</td>`;
    return `<td class="cell ${cls(r.score)}" data-e="${e.id}" data-f="${g.file}" title="total ${r.fields.total?.ok ? '✓' : '✗'} · items F1 ${r.fields.items?.value ?? 'n/a'} · ${r.ms} ms">${pct(r.score)}${r.fields.total?.ok ? '' : '<sup>T✗</sup>'}${r.audit?.ok ? ' ✓' : ''}</td>`;
  }).join('')}</tr>`).join('');
  const sums = engines.map(engineSummary);
  const sumRow = (label, f) => `<tr class="summary"><td colspan="2">${label}</td>${sums.map(s => `<td class="cell">${s ? f(s) : ''}</td>`).join('')}</tr>`;
  $('matrix').innerHTML = head + rows +
    sumRow('Mean score', s => `<span class="${cls(s.score)}">${pct(s.score)}</span>`) +
    sumRow('Totals correct', s => `${s.totals}/${s.n}`) +
    sumRow('Items F1', s => s.items == null ? 'n/a' : pct(s.items)) +
    sumRow('Self-check ✓ → total right', s => s.auditPrecision == null ? '–' : `${s.auditPass}: ${pct(s.auditPrecision)}%`) +
    sumRow('Avg time / receipt', s => `${(s.ms / 1000).toFixed(1)}s`) +
    sumRow('Errors', s => s.errors || '');
  $('matrix').querySelectorAll('td.cell[data-e]').forEach(td => td.onclick = () => showDetail(td.dataset.e, td.dataset.f));
}

function showDetail(engineId, file) {
  state.selected = { engine: engineId, file };
  const e = ENGINES.find(x => x.id === engineId), g = state.gt.find(x => x.file === file), r = state.results[key(engineId, file)];
  const runOne = `<button id="rerun">Run ${esc(e.label)} on this receipt</button>`;
  let body;
  if (!r || r.running) body = `<p class="muted">${r?.running ? 'Running…' : 'Not run yet.'}</p>`;
  else if (r.error) body = `<p class="no">Error: ${esc(r.error)}</p>${r.raw ? `<pre>${esc(r.raw)}</pre>` : ''}`;
  else {
    const f = r.fields;
    const fieldRows = Object.entries(f).filter(([k]) => k !== 'items').map(([k, v]) =>
      `<tr><td>${k}</td><td class="${v.ok ? 'ok' : 'no'}">${v.ok ? '✓' : '✗'}</td><td>${esc(v.gt)}</td><td>${esc(v.pred)}</td></tr>`).join('');
    const n = g.items_unlabeled ? 0 : Math.max(g.items.length, r.pred.items.length);
    const itemRows = Array.from({ length: n }, (_, i) => {
      const a = g.items[i], b = r.pred.items[i];
      return `<tr><td>${esc(a?.name)}</td><td>${a?.qty ?? ''}</td><td>${a?.total ?? ''}</td><td>${esc(b?.name)}</td><td>${b?.qty ?? ''}</td><td>${b?.total ?? ''}</td></tr>`;
    }).join('');
    body = `
      <p><strong>Score ${pct(r.score)}</strong> · ${r.ms} ms · load ${r.loadMs} ms · ${f.items ? `items F1 ${f.items.value} (P ${f.items.precision} / R ${f.items.recall}, ${f.items.matched}/${f.items.gt} matched, ${f.items.amountOnly} by amount)` : 'items not labelled'}
        · self-check <span class="${r.audit.ok ? 'ok' : 'no'}">${r.audit.ok ? 'passed' : 'failed'}</span></p>
      <table><tr><th>Field</th><th></th><th>Ground truth</th><th>Output</th></tr>${fieldRows}</table>
      <details open><summary>Items (in order)</summary><table><tr><th>GT name</th><th>qty</th><th>total</th><th>Output name</th><th>qty</th><th>total</th></tr>${itemRows}</table></details>
      <details><summary>Self-check</summary><pre>${esc(r.audit.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n'))}</pre></details>
      ${r.ocrText ? `<details><summary>OCR text sent to model</summary><pre>${esc(r.ocrText)}</pre></details>` : ''}
      <details><summary>Raw model output</summary><pre>${esc(r.raw)}</pre></details>
      <details><summary>Timings</summary><pre>${esc(JSON.stringify(r.timings, null, 2))}</pre></details>
      <details><summary>Ground-truth notes</summary><ul>${g.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>`;
  }
  $('detail').innerHTML = `<div class="detail"><div><img src="${dataset().dir + encodeURIComponent(file)}" alt="${esc(file)}"/></div>
    <div><h3 style="margin-top:0">${esc(file)} — ${esc(e.label)}</h3>${runOne}${body}</div></div>`;
  $('rerun').onclick = async () => {
    if (state.running) return;
    state.running = true; state.stop = false;
    await runEngine(e, [file]);
    state.running = false;
    showDetail(engineId, file);
    status('Done.');
  };
}

function exportResults() {
  const summary = Object.fromEntries(ENGINES.map(e => [e.id, engineSummary(e)]).filter(([, s]) => s));
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), userAgent: navigator.userAgent, summary, results: state.results }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `bench-results-${Date.now()}.json` });
  a.click();
}

// Console/automation hook.
window.bench = { state, ENGINES, runAll, runEngine, setDataset: async v => { $('dataset').value = v; await loadDataset(); render(); }, summary: () => Object.fromEntries(ENGINES.map(e => [e.id, engineSummary(e)]).filter(([, s]) => s)) };

init().catch(err => { console.error(err); status(`Init failed: ${err.message}`); });
