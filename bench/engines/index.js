// Every engine the bench can run. approxMB = one-time download incl. OCR (~16 MB).
import rules from './rules.js';
import solver from './solver.js';
import donut from './donut.js';
import { makeOcrLlmEngine } from './ocr-llm-tjs.js';
import { makeWebLlmEngine } from './ocr-llm-webllm.js';
import { makeVlmEngine } from './vlm-tjs.js';
import { makeChromeEngine } from './chrome-prompt.js';

export const ENGINES = [
  rules,
  solver,

  // OCR → small text LLM
  makeOcrLlmEngine({ id: 'ocr-lfm2-extract-350m', label: 'OCR + LFM2-350M-Extract', model: 'onnx-community/LFM2-350M-Extract-ONNX', dtype: 'q4f16', approxMB: 330 }),
  makeOcrLlmEngine({ id: 'ocr-gemma3-270m', label: 'OCR + Gemma 3 270M', model: 'onnx-community/gemma-3-270m-it-ONNX', dtype: 'q4f16', approxMB: 290 }),
  makeWebLlmEngine({ id: 'ocr-qwen3-0.6b-webllm', label: 'OCR + Qwen3-0.6B (WebLLM, JSON-constrained)', model: 'Qwen3-0.6B-q4f16_1-MLC', approxMB: 370 }),
  makeWebLlmEngine({ id: 'ocr-qwen3.5-0.8b-webllm', label: 'OCR + Qwen3.5-0.8B (WebLLM, JSON-constrained)', model: 'Qwen3.5-0.8B-q4f16_1-MLC', approxMB: 500 }),
  makeOcrLlmEngine({ id: 'ocr-qwen3-0.6b-tjs', label: 'OCR + Qwen3-0.6B (transformers.js)', model: 'onnx-community/Qwen3-0.6B-ONNX', dtype: 'q4f16', approxMB: 586, chatOptions: { enable_thinking: false } }),
  makeOcrLlmEngine({ id: 'ocr-lfm2-extract-1.2b', label: 'OCR + LFM2-1.2B-Extract (over budget)', model: 'onnx-community/LFM2-1.2B-Extract-ONNX', dtype: 'q4f16', approxMB: 884 }),
  makeWebLlmEngine({ id: 'ocr-qwen3-1.7b-webllm', label: 'OCR + Qwen3-1.7B (WebLLM, over budget)', model: 'Qwen3-1.7B-q4f16_1-MLC', approxMB: 1000 }),

  // Image → JSON directly
  makeVlmEngine({ id: 'vlm-smolvlm-256m', label: 'SmolVLM-256M', model: 'HuggingFaceTB/SmolVLM-256M-Instruct', call: 'text,[image]', approxMB: 321, maxSide: 1536, dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' }, processorOptions: { do_image_splitting: true } }),
  makeVlmEngine({ id: 'vlm-lfm2.5-vl-450m', label: 'LFM2.5-VL-450M', model: 'onnx-community/LFM2.5-VL-450M-ONNX', call: 'image,text', approxMB: 545, maxSide: 1536, dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' } }),
  makeVlmEngine({ id: 'vlm-smolvlm-500m', label: 'SmolVLM-500M', model: 'HuggingFaceTB/SmolVLM-500M-Instruct', call: 'text,[image]', approxMB: 497, maxSide: 1536, dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' }, processorOptions: { do_image_splitting: true } }),
  makeVlmEngine({ id: 'vlm-qwen3.5-0.8b', label: 'Qwen3.5-0.8B (vision)', model: 'onnx-community/Qwen3.5-0.8B-ONNX', call: 'text,image', approxMB: 647, maxSide: 1280, dtype: { embed_tokens: 'q4f16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' }, chatOptions: { enable_thinking: false } }),
  makeVlmEngine({ id: 'vlm-qwen3-vl-2b', label: 'Qwen3-VL-2B (over budget, ceiling)', model: 'onnx-community/Qwen3-VL-2B-Instruct-ONNX', call: 'text,image', approxMB: 1373, maxSide: 1280, dtype: 'q4f16' }),
  donut,

  // Browser built-in
  makeChromeEngine({ id: 'chrome-nano-image', label: 'Chrome Gemini Nano (image)', mode: 'image' }),
  makeChromeEngine({ id: 'chrome-nano-ocr', label: 'Chrome Gemini Nano (OCR text)', mode: 'text' }),
];
