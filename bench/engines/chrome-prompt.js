// Chrome's built-in model (Gemini Nano) through the Prompt API. Zero download
// for the page; Chrome manages the model. Two modes: image in, or OCR text in.
import { layoutText } from '../lib/ocr.js';
import { parseModelJson } from '../lib/json.js';
import { JSON_SCHEMA } from '../lib/schema.js';
import { SYSTEM_TEXT, VISION_PROMPT, userText } from './prompt.js';

function api() {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('Prompt API (LanguageModel) not available in this browser');
  return LM;
}

export function makeChromeEngine({ id, label, mode }) {
  let session = null;
  const expectedInputs = mode === 'image' ? [{ type: 'image' }, { type: 'text' }] : [{ type: 'text' }];
  return {
    id, label, family: 'builtin', approxMB: 0,
    async load(ctx) {
      if (mode === 'text') await ctx.ocr();
      const LM = api();
      const avail = await LM.availability({ expectedInputs });
      if (avail === 'unavailable') throw new Error(`Prompt API unavailable for ${mode} input`);
      session = await LM.create({
        expectedInputs,
        initialPrompts: [{ role: 'system', content: mode === 'image' ? 'You read receipts and output JSON.' : SYSTEM_TEXT }],
        monitor: m => m.addEventListener('downloadprogress', e => ctx.progress(`Gemini Nano download ${(e.loaded * 100).toFixed(0)}%`)),
      });
    },
    async run(input, ctx) {
      const s = await session.clone();
      const t0 = performance.now();
      let ocrText, content, boxes;
      if (mode === 'image') {
        content = [{ type: 'text', value: VISION_PROMPT }, { type: 'image', value: input.canvas }];
      } else {
        boxes = await ctx.ocrBoxes(input);
        ocrText = layoutText(boxes);
        content = [{ type: 'text', value: userText(ocrText) }];
      }
      const t1 = performance.now();
      const raw = await s.prompt([{ role: 'user', content }], { responseConstraint: JSON_SCHEMA });
      s.destroy();
      return { raw, ocrText, result: parseModelJson(raw), timings: { ocrWait: t1 - t0, ocr: boxes?.ocrMs ?? 0, llm: performance.now() - t1 } };
    },
    async unload() { session?.destroy(); session = null; },
  };
}
