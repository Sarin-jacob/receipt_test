// Node module hook for scripts/score.mjs: the OCR wrapper imports PaddleOCR from a CDN URL,
// which Node can't load. Scoring only needs the solver, so that import becomes an empty stub.
const STUB = 'data:text/javascript,export const PaddleOCR = { create() { throw new Error("no OCR in Node"); } };';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://')) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
