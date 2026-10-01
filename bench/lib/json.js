// Tolerant JSON extraction for small-model output: strips fences/think blocks,
// finds the outermost object, and repairs the most common breakages.
export function parseLooseJson(text) {
  if (text == null) throw new Error('empty output');
  let s = String(text)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  const start = s.indexOf('{');
  if (start === -1) throw new Error('no JSON object in output');
  s = s.slice(start);

  try { return JSON.parse(s); } catch {}

  // Cut to the last balanced closing brace, or close whatever is still open.
  const closed = balance(s);
  const repaired = closed
    .replace(/,\s*([\]}])/g, '$1')            // trailing commas
    .replace(/([{,]\s*)'([^']*)'\s*:/g, '$1"$2":') // single-quoted keys
    .replace(/:\s*'([^']*)'/g, ': "$1"')        // single-quoted values
    .replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
  return JSON.parse(repaired);
}

function balance(s) {
  const stack = [];
  let inStr = false, esc = false, lastGood = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) { lastGood = i; break; }
    }
  }
  if (lastGood !== -1) return s.slice(0, lastGood + 1);
  // Truncated output (ran out of tokens): drop the dangling fragment and close.
  let t = s;
  if (inStr) t += '"';
  t = t.replace(/,\s*"[^"]*"?\s*:?\s*$/, '').replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  return t + stack.reverse().join('');
}

// Same, but keeps the model's raw text on the error so the bench can show it.
export function parseModelJson(raw) {
  try { return parseLooseJson(raw); }
  catch (err) { err.raw = raw; throw err; }
}
