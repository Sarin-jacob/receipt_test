// Donut fine-tuned on CORD (Indonesian receipts). Image → CORD token sequence.
import { pipeline, RawImage } from '../lib/tjs.js';

let pipe = null;

export default {
  id: 'donut-cord',
  label: 'Donut CORD-v2',
  family: 'vlm',
  approxMB: 413,
  model: 'Xenova/donut-base-finetuned-cord-v2',
  async load(ctx) {
    pipe = await pipeline('image-to-text', this.model, { dtype: 'fp16', device: ctx.device, progress_callback: ctx.hfProgress });
  },
  async run(input) {
    const t0 = performance.now();
    const image = await RawImage.fromCanvas(input.canvas);
    const [out] = await pipe(image, { prompt: '<s_cord-v2>', max_new_tokens: 768 });
    const raw = out.generated_text;
    const cord = tokensToJson(raw);
    const menus = [].concat(cord.menu ?? []);
    const sub = cord.sub_total ?? {}, tot = cord.total ?? {};
    return {
      raw,
      timings: { vlm: performance.now() - t0 },
      result: {
        items: menus.map(m => ({ name: m.nm, qty: m.cnt, unit_price: m.unitprice, total: m.price })),
        subtotal: sub.subtotal_price,
        taxes: sub.tax_price ? [{ label: 'tax', amount: sub.tax_price }] : [],
        charges: sub.service_price ? [{ label: 'service', amount: sub.service_price }] : [],
        discounts: sub.discount_price ? [{ label: 'discount', amount: sub.discount_price }] : [],
        total: tot.total_price,
        payment_method: tot.cashprice ? 'cash' : tot.creditcardprice ? 'card' : null,
      },
    };
  },
  async unload() { await pipe?.dispose?.(); pipe = null; },
};

// Port of DonutProcessor.token2json.
function tokensToJson(seq) {
  seq = seq.replace(/<s_cord-v2>|<\/s>|<s>|<pad>/g, '').trim();
  const out = {};
  while (seq) {
    const start = seq.match(/<s_(.*?)>/);
    if (!start) break;
    const key = start[1];
    const end = seq.indexOf(`</s_${key}>`);
    const startIdx = seq.indexOf(start[0]);
    if (end === -1) { seq = seq.slice(startIdx + start[0].length); continue; }
    const content = seq.slice(startIdx + start[0].length, end).trim();
    if (/<s_/.test(content)) {
      const parts = content.split(/<sep\/>/).map(tokensToJson);
      out[key] = parts.length === 1 ? parts[0] : parts;
    } else {
      out[key] = content.replace(/<sep\/>/g, ' ').trim();
    }
    seq = seq.slice(end + `</s_${key}>`.length).trim();
  }
  return out;
}
