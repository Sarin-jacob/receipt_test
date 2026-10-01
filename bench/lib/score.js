// Compares a normalized engine result against one ground_truth.json entry.
const close = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.011;

function bigrams(s) {
  const t = ` ${String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}
export function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map();
  A.forEach(g => counts.set(g, (counts.get(g) || 0) + 1));
  let hit = 0;
  B.forEach(g => { const c = counts.get(g); if (c) { hit++; counts.set(g, c - 1); } });
  return (2 * hit) / (A.length + B.length);
}

function matchItems(gtItems, predItems) {
  const used = new Set();
  let matched = 0, amountOnly = 0;
  for (const g of gtItems) {
    let best = -1, bestSim = -1;
    predItems.forEach((p, i) => {
      if (used.has(i) || !close(p.total, g.total)) return;
      const sim = similarity(p.name, g.name);
      if (sim > bestSim) { bestSim = sim; best = i; }
    });
    if (best === -1) continue;
    used.add(best);
    amountOnly++;
    if (bestSim >= 0.45) matched++;
  }
  return { matched, amountOnly };
}

const WEIGHTS = { total: 3, items: 3, subtotal: 1, tax: 1, date: 1, merchant: 1 };

export function score(gt, pred) {
  const fields = {};

  // Unreadable photos / non-receipts: the right answer is "no total", not a guess.
  if (gt.expect_no_total) fields.total = { ok: pred.total == null, gt: null, pred: pred.total };
  else if (gt.total != null) fields.total = { ok: close(pred.total, gt.total), gt: gt.total, pred: pred.total };

  if (gt.subtotal != null) fields.subtotal = { ok: close(pred.subtotal, gt.subtotal), gt: gt.subtotal, pred: pred.subtotal };

  if (gt.taxes.length) {
    const g = gt.taxes.reduce((s, t) => s + t.amount, 0), p = pred.taxes.reduce((s, t) => s + t.amount, 0);
    fields.tax = { ok: close(Math.round(p * 100) / 100, Math.round(g * 100) / 100), gt: g, pred: p };
  }

  if (gt.document.date) {
    const options = String(pred.date ?? '').split('|');
    fields.date = { ok: options.includes(gt.document.date), gt: gt.document.date, pred: pred.date };
  }

  if (gt.document.time) {
    const hm = t => (String(t ?? '').match(/^(\d{1,2}):(\d{2})/) || []).slice(1).map(Number).join(':');
    fields.time = { ok: !!pred.time && hm(pred.time) === hm(gt.document.time), gt: gt.document.time, pred: pred.time };
  }

  if (gt.merchant.name) {
    const sim = similarity(pred.merchant, gt.merchant.name);
    fields.merchant = { ok: sim >= 0.6, gt: gt.merchant.name, pred: pred.merchant, sim: +sim.toFixed(2) };
  }

  // Items: F1 over (amount equal AND name similar). Empty-vs-empty counts as perfect,
  // anything invented on a receipt with no visible items scores 0.
  if (gt.items_unlabeled) return finish(fields); // e.g. SROIE: only company/date/total are labelled

  const g = gt.items, p = pred.items;
  let f1, precision, recall, matched = 0, amountOnly = 0;
  if (!g.length) { f1 = p.length ? 0 : 1; precision = f1; recall = 1; }
  else {
    ({ matched, amountOnly } = matchItems(g, p));
    precision = p.length ? matched / p.length : 0;
    recall = matched / g.length;
    f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  }
  fields.items = { ok: f1 >= 0.999, value: +f1.toFixed(3), precision: +precision.toFixed(3), recall: +recall.toFixed(3), gt: g.length, pred: p.length, matched, amountOnly };
  return finish(fields);
}

function finish(fields) {
  let num = 0, den = 0;
  for (const [k, f] of Object.entries(fields)) {
    const w = WEIGHTS[k] ?? 1;
    num += w * (k === 'items' ? f.value : f.ok ? 1 : 0);
    den += w;
  }
  return { score: +(num / den).toFixed(3), fields };
}
