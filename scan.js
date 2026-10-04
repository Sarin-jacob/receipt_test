/*! Receipt Scan v1.0.0 | PolyForm Noncommercial 1.0.0, see LICENSE.txt | Required Notice: Copyright (c) 2026 Sarin Jacob (https://github.com/Sarin-jacob/receipt_test) */
// Receipt scan: photo → user-adjustable crop (4 corners, perspective-corrected)
// → optional brightness / contrast / B&W → PaddleOCR → line solver.
import { getOcr } from './lib/ocr.js?v=163076e';
import { ocrPhoto, enhance } from './lib/preprocess.js?v=163076e';
import { solveReceipt } from './lib/solver.js?v=163076e';
import { normalize } from './lib/schema.js?v=163076e';
import { audit } from './lib/audit.js?v=163076e';

const $ = id => document.getElementById(id);
const MAX_SOURCE = 3000;   // working copy of the photo
const MAX_OUTPUT = 2400;   // flattened receipt sent to OCR

let source = null;         // canvas holding the (rotated) photo
let quad = null;           // [tl, tr, br, bl] in source pixels
let ocrReady = null;

// ---------- loading ----------
$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  status('Opening photo…');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
  source = canvasOf(Math.round(bmp.width * s), Math.round(bmp.height * s));
  source.getContext('2d').drawImage(bmp, 0, 0, source.width, source.height);
  quad = autoQuad(source);
  show('edit');
  draw();
  status('');
  ocrReady ??= getOcr('v6-small'); // start the model download while the user adjusts
  e.target.value = '';
});

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function show(which) {
  $('edit').hidden = which !== 'edit';
  $('result').hidden = which !== 'result';
  $('pick').hidden = which === 'result';
}
const status = msg => { $('status').textContent = msg; };

// ---------- automatic corners ----------
// Receipts are usually the brightest large region in the photo. Threshold a
// small copy (Otsu), keep the biggest bright blob and take its extreme corners.
function autoQuad(src) {
  const full = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
  const s = 320 / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const small = canvasOf(w, h);
  const g = small.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const lum = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) { lum[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; hist[lum[i]]++; }
  const t = otsu(hist, w * h);
  // Largest 4-connected bright component.
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || lum[start] <= t) continue;
    const stack = [start], pts = [];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      pts.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && lum[q] > t) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!best || pts.length > best.length) best = pts;
  }
  if (!best) return full;
  const area = best.length / (w * h);
  if (area < 0.08 || area > 0.92) return full; // nothing paper-like, or a screenshot/scan
  const rect = minAreaRect(hull(best.map(p => [p % w, (p / w) | 0])));
  if (!rect) return full;
  // Pad a little so the paper edge (and any text on it) stays inside.
  const cx = rect.reduce((s, p) => s + p[0], 0) / 4, cy = rect.reduce((s, p) => s + p[1], 0) / 4;
  return rect.map(([x, y]) => [
    Math.min(src.width, Math.max(0, (cx + (x - cx) * 1.03) / s)),
    Math.min(src.height, Math.max(0, (cy + (y - cy) * 1.03) / s)),
  ]);
}

// Convex hull (monotone chain).
function hull(pts) {
  pts = [...new Map(pts.map(p => [p[0] * 10000 + p[1], p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Smallest rectangle around the hull (tries each hull edge as a side). Returns
// corners ordered tl, tr, br, bl in the rectangle's own frame, with "top" being
// the side closest to horizontal, so a tilted receipt comes out upright.
function minAreaRect(h) {
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const [x1, y1] = h[i], [x2, y2] = h[(i + 1) % h.length];
    let a = Math.atan2(y2 - y1, x2 - x1);
    // Normalise to (-45°, 45°] so u runs along the most horizontal side.
    while (a > Math.PI / 4) a -= Math.PI / 2;
    while (a <= -Math.PI / 4) a += Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of h) {
      const u = x * c + y * s, v = -x * s + y * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, c, s, u0, u1, v0, v1 };
  }
  const { c, s, u0, u1, v0, v1 } = best;
  const back = (u, v) => [u * c - v * s, u * s + v * c];
  let q = [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)];
  // Receipts are portrait: if the "top" side is the long one, turn a quarter,
  // choosing the turn that keeps the top edge nearer the top of the photo.
  if (u1 - u0 > (v1 - v0) * 1.15) {
    const cw = [q[3], q[0], q[1], q[2]], ccw = [q[1], q[2], q[3], q[0]];
    const topY = r => (r[0][1] + r[1][1]) / 2;
    q = topY(cw) <= topY(ccw) ? cw : ccw;
  }
  return q;
}

function otsu(hist, n) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

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

// ---------- flatten + enhance ----------
// Maps the user's quadrilateral to an upright rectangle (perspective correction).
function warp(src, q) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, MAX_OUTPUT / Math.max(W, H));
  W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));
  const out = canvasOf(W, H);
  const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
  const og = out.getContext('2d');
  const img = og.createImageData(W, H), od = img.data;
  const sw = src.width, sh = src.height;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const z = Hm[6] * u + Hm[7] * v + 1;
      const x = (Hm[0] * u + Hm[1] * v + Hm[2]) / z, y = (Hm[3] * u + Hm[4] * v + Hm[5]) / z;
      const o = (v * W + u) * 4;
      if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        od[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      }
      od[o + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// Solves the 8 homography coefficients mapping `from` points onto `to` points.
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [X, Y] = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return h;
}

// Same adjustments as the preview, applied to pixels.
function applyAdjustments(canvas, a) {
  let c = a.autoLevels ? enhance(canvas) : canvas;
  if (!a.bright && !a.contrast && !a.gray) return c;
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const k = 1 + a.contrast / 100, add = a.bright * 2.55;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v - 128) * k + 128 + add;
  for (let i = 0; i < d.length; i += 4) {
    if (a.gray) { const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = d[i + 1] = d[i + 2] = lut[l]; }
    else { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  }
  if (c === canvas) c = canvasOf(canvas.width, canvas.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

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
    const { _lines, _debug, ...raw } = solveReceipt(boxes);
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
