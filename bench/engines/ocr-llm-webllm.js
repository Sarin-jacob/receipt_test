// PaddleOCR → layout text → small LLM via WebLLM with JSON-schema constrained
// decoding, so the output is always valid JSON in our shape.
import { layoutText } from '../lib/ocr.js';
import { JSON_SCHEMA } from '../lib/schema.js';
import { parseModelJson } from '../lib/json.js';
import { SYSTEM_TEXT, userText } from './prompt.js';

let webllm = null;

export function makeWebLlmEngine({ id, label, model, approxMB, constrained = true }) {
  let engine = null;
  return {
    id, label, family: 'ocr+llm', approxMB, model,
    async load(ctx) {
      await ctx.ocr();
      webllm ??= await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm');
      engine = await webllm.CreateMLCEngine(model, {
        initProgressCallback: p => ctx.progress(`${label}: ${p.text}`),
      }, { context_window_size: 4096 });
    },
    async run(input, ctx) {
      const t0 = performance.now();
      const boxes = await ctx.ocrBoxes(input);
      const ocrText = layoutText(boxes);
      const t1 = performance.now();
      const reply = await engine.chat.completions.create({
        messages: [{ role: 'system', content: SYSTEM_TEXT }, { role: 'user', content: userText(ocrText) }],
        temperature: 0,
        max_tokens: 1500,
        ...(constrained ? { response_format: { type: 'json_object', schema: JSON.stringify(JSON_SCHEMA) } } : {}),
        extra_body: { enable_thinking: false },
      });
      const raw = reply.choices[0].message.content;
      return { raw, ocrText, result: parseModelJson(raw), timings: { ocrWait: t1 - t0, ocr: boxes.ocrMs, llm: performance.now() - t1, tokensIn: reply.usage?.prompt_tokens } };
    },
    async unload() { await engine?.unload(); engine = null; },
  };
}
