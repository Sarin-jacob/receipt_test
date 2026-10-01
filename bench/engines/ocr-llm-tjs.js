// PaddleOCR → layout text → small text LLM via transformers.js (WebGPU).
import { AutoTokenizer, AutoModelForCausalLM } from '../lib/tjs.js';
import { layoutText } from '../lib/ocr.js';
import { parseModelJson } from '../lib/json.js';
import { SYSTEM_TEXT, userText } from './prompt.js';

export function makeOcrLlmEngine({ id, label, model, dtype = 'q4f16', approxMB, chatOptions = {}, maxNewTokens = 1500 }) {
  let tokenizer = null, llm = null;
  return {
    id, label, family: 'ocr+llm', approxMB, model,
    async load(ctx) {
      await ctx.ocr();
      tokenizer = await AutoTokenizer.from_pretrained(model);
      llm = await AutoModelForCausalLM.from_pretrained(model, { dtype, device: ctx.device, progress_callback: ctx.hfProgress });
    },
    async run(input, ctx) {
      const t0 = performance.now();
      const boxes = await ctx.ocrBoxes(input);
      const ocrText = layoutText(boxes);
      const t1 = performance.now();
      const messages = [{ role: 'system', content: SYSTEM_TEXT }, { role: 'user', content: userText(ocrText) }];
      const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, ...chatOptions });
      const out = await llm.generate({ ...inputs, max_new_tokens: maxNewTokens, do_sample: false, repetition_penalty: 1.05 });
      const raw = tokenizer.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0];
      const t2 = performance.now();
      return { raw, ocrText, result: parseModelJson(raw), timings: { ocrWait: t1 - t0, ocr: boxes.ocrMs, llm: t2 - t1, tokensIn: inputs.input_ids.dims.at(-1) } };
    },
    async unload() { await llm?.dispose?.(); llm = null; tokenizer = null; },
  };
}
