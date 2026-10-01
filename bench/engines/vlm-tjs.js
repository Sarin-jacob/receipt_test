// Image → JSON directly with a small vision-language model via transformers.js.
import { AutoProcessor, AutoModelForImageTextToText, RawImage } from '../lib/tjs.js';
import { parseModelJson } from '../lib/json.js';
import { VISION_PROMPT } from './prompt.js';

// Processors disagree on argument order:
//   'image,text'   LFM2-VL
//   'text,image'   Qwen-VL family
//   'text,[image]' Idefics3 family (SmolVLM, granite-docling)
export function makeVlmEngine({ id, label, model, dtype, approxMB, call, maxSide = 1024, processorOptions = {}, chatOptions = {}, maxNewTokens = 1500 }) {
  let processor = null, vlm = null;
  return {
    id, label, family: 'vlm', approxMB, model,
    async load(ctx) {
      processor = await AutoProcessor.from_pretrained(model);
      vlm = await AutoModelForImageTextToText.from_pretrained(model, { dtype, device: ctx.device, progress_callback: ctx.hfProgress });
    },
    async run(input) {
      const t0 = performance.now();
      const image = await fitImage(await RawImage.fromCanvas(input.canvas), maxSide);
      const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: VISION_PROMPT }] }];
      const text = processor.apply_chat_template(messages, { add_generation_prompt: true, ...chatOptions });
      const inputs =
        call === 'image,text' ? await processor(image, text, { add_special_tokens: false, ...processorOptions })
        : call === 'text,[image]' ? await processor(text, [image], processorOptions)
        : await processor(text, image, processorOptions);
      const t1 = performance.now();
      const out = await vlm.generate({ ...inputs, max_new_tokens: maxNewTokens, do_sample: false, repetition_penalty: 1.05 });
      const raw = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0];
      return { raw, result: parseModelJson(raw), timings: { prep: t1 - t0, vlm: performance.now() - t1, tokensIn: inputs.input_ids.dims.at(-1) } };
    },
    async unload() { await vlm?.dispose?.(); vlm = null; processor = null; },
  };
}

async function fitImage(img, maxSide) {
  const s = maxSide / Math.max(img.width, img.height);
  if (s >= 1) return img;
  return img.resize(Math.round(img.width * s), Math.round(img.height * s));
}
