// PaddleOCR + line tagging + arithmetic solver (no generative model).
import { solveReceipt } from '../lib/solver.js';

export default {
  id: 'ocr-solver',
  label: 'PaddleOCR + line solver (no LLM)',
  family: 'rules',
  approxMB: 16,
  async load(ctx) { await ctx.ocr(); },
  async run(input, ctx) {
    const t0 = performance.now();
    const boxes = await ctx.ocrBoxes(input);
    const t1 = performance.now();
    const { _lines, _debug, ...result } = solveReceipt(boxes);
    return { raw: JSON.stringify(result, null, 2), ocrText: _lines, result, timings: { ocrWait: t1 - t0, ocr: boxes.ocrMs, solve: performance.now() - t1 } };
  },
};
