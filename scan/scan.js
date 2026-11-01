// Receipt scan: photo → user-adjustable crop (4 corners, perspective-corrected)
// → optional brightness / contrast / B&W → PaddleOCR → line solver.
import { getOcr } from '../bench/lib/ocr.js';
import { ocrPhoto } from '../bench/lib/preprocess.js';
import { canvasOf, autoQuad, warp, applyAdjustments, MAX_SOURCE, fitScale } from './pipeline.js';
import { solveReceipt } from '../bench/lib/solver.js';
import { normalize } from '../bench/lib/schema.js';
import { audit } from '../bench/lib/audit.js';

const $ = id => document.getElementById(id);

let source = null;         // canvas holding the (rotated) photo
let quad = null;           // [tl, tr, br, bl] in source pixels
let ocrReady = null;
let hints = {};           // file name / time: screenshots' date and app (solver.js withApp)

// ---------- loading ----------
$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  hints = { fileName: file.name, fileTime: file.lastModified };
  status('Opening photo…');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = fitScale(bmp.width, bmp.height, MAX_SOURCE);
  source = canvasOf(Math.round(bmp.width * s), Math.round(bmp.height * s));
  source.getContext('2d').drawImage(bmp, 0, 0, source.width, source.height);
  quad = autoQuad(source);
  show('edit');
  draw();
  status('');
  ocrReady ??= getOcr('v6-small'); // start the model download while the user adjusts
  e.target.value = '';
});


function show(which) {
  $('edit').hidden = which !== 'edit';
  $('result').hidden = which !== 'result';
  $('pick').hidden = which === 'result';
}
const status = msg => { $('status').textContent = msg; };


// ---------- editor ----------
function adjustments() {
  return { bright: +$('bright').value, contrast: +$('contrast').value, gray: $('gray').checked, autoLevels: $('autoLevels').checked };
}

function draw() {
  const view = $('view');
  view.width = source.width; view.height = source.height;
  const g = view.getContext('2d');
  const a = adjustments();
  // Live preview via canvas filters; the scan itself uses the exact pixel LUT below.
  g.filter = `brightness(${1 + a.bright / 100}) contrast(${1 + a.contrast / 100}) grayscale(${a.gray ? 1 : 0})`;
  g.drawImage(source, 0, 0);
  g.filter = 'none';
  const svg = $('overlay');
  svg.setAttribute('viewBox', `0 0 ${source.width} ${source.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const r = source.width / Math.max(1, $('stage').clientWidth) * 12;
  $('poly').setAttribute('points', quad.map(p => p.join(',')).join(' '));
  svg.querySelectorAll('circle').forEach(c => c.remove());
  quad.forEach((p, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', r);
    c.dataset.i = i;
    svg.appendChild(c);
  });
  $('brightV').textContent = a.bright;
  $('contrastV').textContent = a.contrast;
}

// Corner dragging (mouse + touch through pointer events).
let dragging = null;
$('overlay').addEventListener('pointerdown', e => {
  if (e.target.tagName !== 'circle') return;
  dragging = +e.target.dataset.i;
  e.target.setPointerCapture(e.pointerId);
});
$('overlay').addEventListener('pointermove', e => {
  if (dragging == null) return;
  const box = $('stage').getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width * source.width;
  const y = (e.clientY - box.top) / box.height * source.height;
  quad[dragging] = [Math.min(source.width, Math.max(0, x)), Math.min(source.height, Math.max(0, y))];
  draw();
});
['pointerup', 'pointercancel'].forEach(t => $('overlay').addEventListener(t, () => { dragging = null; }));

function rotate(dir) {
  const r = canvasOf(source.height, source.width);
  const g = r.getContext('2d');
  g.translate(r.width / 2, r.height / 2);
  g.rotate(dir * Math.PI / 2);
  g.drawImage(source, -source.width / 2, -source.height / 2);
  source = r;
  quad = autoQuad(source);
  draw();
}
$('rotL').onclick = () => rotate(-1);
$('rotR').onclick = () => rotate(1);
$('autoCrop').onclick = () => { quad = autoQuad(source); draw(); };
$('fullCrop').onclick = () => { quad = [[0, 0], [source.width, 0], [source.width, source.height], [0, source.height]]; draw(); };
['bright', 'contrast', 'gray'].forEach(id => $(id).addEventListener('input', draw));
$('reset').onclick = () => { show('pick'); $('edit').hidden = true; };
$('again').onclick = () => { show('pick'); $('file').click(); };
$('adjust').onclick = () => show('edit');


// ---------- scan ----------
$('scan').onclick = async () => {
  $('scan').disabled = true;
  try {
    status('Preparing image…');
    show('result');
    $('rTotal').textContent = 'Reading…';
    $('rMerchant').textContent = '';
    $('rCheck').textContent = '';
    $('rCheck').className = 'badge';
    $('rMeta').innerHTML = $('rItems').innerHTML = $('rSummary').innerHTML = '';
    await new Promise(r => setTimeout(r, 30)); // let the UI paint
    const flat = applyAdjustments(warp(source, quad), adjustments());
    const prev = $('outPreview');
    prev.width = flat.width; prev.height = flat.height;
    prev.getContext('2d').drawImage(flat, 0, 0);
    $('rTotal').textContent = 'Loading OCR model…';
    await (ocrReady ??= getOcr('v6-small'));
    $('rTotal').textContent = 'Reading…';
    const t0 = performance.now();
    const boxes = await ocrPhoto(flat, { ocrModel: 'v6-small', crop: true, contrast: false });
    const { _lines, _debug, ...raw } = solveReceipt(boxes, hints);
    const r = normalize(raw), check = audit(r);
    renderResult(r, check, _lines, performance.now() - t0);
  } catch (err) {
    console.error(err);
    $('rTotal').textContent = 'Could not read this photo';
    $('rMerchant').textContent = err.message;
  } finally {
    $('scan').disabled = false;
    status('');
  }
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (v, cur) => v == null ? '—' : `${cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur && !['INR', 'USD', 'EUR', 'GBP'].includes(cur) ? ' ' + cur : ''}`;

// "2026-02-11" → "11 Feb 2026 (Wed)", "21:05" → "9:05 PM" in the viewer's locale.
function niceDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} (${d.toLocaleDateString(undefined, { weekday: 'short' })})`;
}
function niceTime(t) {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? new Date(2000, 0, 1, +m[1], +m[2]).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
}

// Everything else printed on the receipt: document number, merchant contact and
// registration numbers, staff / table, payment details, repeated items, printed counts.
function renderDetails(r) {
  const d = r.details ?? {};
  const pay = d.payment ?? {};
  const counts = d.counts ?? {};
  const rows = [
    ['Bill / invoice no.', r.invoice_number],
    ['Table', d.document?.table],
    ['Terminal', d.document?.terminal],
    ['Staff', d.staff],
    ['Registered name', d.legal_name],
    ['Address', d.address],
    ['Phone', r.phones?.join(', ')],
    ['Email', d.email],
    ['Website', d.website],
    ...(d.ids ?? []).map(id => [id.type, id.value]),
    ['Payment', [pay.method, pay.card_type, pay.card_last4 && `•••• ${pay.card_last4}`, pay.upi_id].filter(Boolean).join(' · ')],
    ['Payment ref.', pay.reference],
    ['Tendered', pay.tendered != null ? money(pay.tendered, r.currency) : null],
    ['Change', pay.change != null ? money(pay.change, r.currency) : null],
    ['Items read', `${counts.items ?? r.items.length} lines, qty ${counts.qty ?? ''}${counts.printed_items != null || counts.printed_qty != null ? ` (receipt says ${[counts.printed_items != null && `${counts.printed_items} items`, counts.printed_qty != null && `qty ${counts.printed_qty}`].filter(Boolean).join(', ')})` : ''}`],
    ...(d.repeated_items ?? []).map(g => [`${g.name} ×${g.rows} rows`, `qty ${g.qty}, ${money(g.total, r.currency)}`]),
  ].filter(([, v]) => v != null && v !== '');
  $('rDetails').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('rJson').textContent = JSON.stringify(r, null, 2);
}

function renderResult(r, check, lines, ms) {
  $('rMerchant').textContent = r.merchant || 'Unknown merchant';
  $('rTotal').textContent = r.total == null ? 'No total found' : money(r.total, r.currency);
  const failed = check.checks.filter(c => !c.ok);
  $('rCheck').className = 'badge ' + (check.ok ? 'good' : 'warn');
  $('rCheck').textContent = check.ok ? 'Numbers add up ✓' : 'Please check';
  $('rCheck').title = failed.map(c => `${c.name}: ${c.detail}`).join('\n');
  $('rMeta').innerHTML = [['Date', niceDate(r.date)], ['Time', niceTime(r.time)], ['Paid by', r.payment_method], ['Read in', `${(ms / 1000).toFixed(1)} s`]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('rItems').innerHTML = r.items.length
    ? `<tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>` + r.items.map(i => `<tr>
        <td>${esc(i.name)}${i.description ? `<div class="muted">${i.description.map(esc).join('<br>')}</div>` : ''}${i.discount ? `<div class="muted">discount ${money(i.discount, r.currency)}</div>` : ''}</td>
        <td class="n">${i.qty ?? ''}${i.unit ? ' ' + esc(i.unit) : ''}</td>
        <td class="n">${i.unit_price != null ? money(i.unit_price, r.currency) : ''}</td>
        <td class="n">${money(i.total, r.currency)}</td></tr>`).join('')
    : '';
  renderDetails(r);
  $('rSummary').innerHTML = [
    ['Subtotal', r.subtotal],
    ...r.discounts.map(d => [d.label || 'Discount', d.amount]),
    ...r.charges.map(c => [c.label || 'Charge', c.amount]),
    ...r.taxes.map(t => [`${t.label || 'Tax'}${t.inclusive ? ' (incl.)' : ''}`, t.amount]),
  ].filter(([, v]) => v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${money(v, r.currency)}</dd>`).join('')
    + (failed.length ? `<dt>Check</dt><dd class="muted">${failed.map(c => esc(`${c.name}: ${c.detail}`)).join('<br>')}</dd>` : '');
  $('rLines').textContent = lines;
}

$('copyJson').onclick = async () => {
  try { await navigator.clipboard.writeText($('rJson').textContent); $('copyJson').textContent = 'Copied ✓'; }
  catch { $('copyJson').textContent = 'Copy failed'; }
  setTimeout(() => { $('copyJson').textContent = 'Copy JSON'; }, 1500);
};
