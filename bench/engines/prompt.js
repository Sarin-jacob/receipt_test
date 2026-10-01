import { PROMPT_SCHEMA, PROMPT_RULES } from '../lib/schema.js';

export const SYSTEM_TEXT = `You extract structured data from receipt OCR text. The text keeps the receipt's column layout.
Return ONLY a JSON object with this schema:
${PROMPT_SCHEMA}
Rules:
${PROMPT_RULES}`;

export const VISION_PROMPT = `Read this receipt and return ONLY a JSON object with this schema:
${PROMPT_SCHEMA}
Rules:
${PROMPT_RULES}`;

export const userText = ocrText => `Receipt OCR text:\n${ocrText}`;
