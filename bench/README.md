# Receipt parser bench

Runs every client-side receipt parsing approach on the same receipts and scores
each one against hand-checked ground truth. Everything runs in the browser, and
models are cached by the browser after their first download.

## Run

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Open <http://localhost:8765/bench/>, tick engines, press **Run selected engines**.
Click any cell to see ground truth vs. output, the OCR text the model saw, the
raw model output and the self-check. Results persist in localStorage; use
**Export results** to save them as JSON.

WebGPU needs Chrome/Edge (or Safari 26+). `localhost` counts as a secure context.

## Datasets

| Dataset | What | Labels |
|---|---|---|
| `reciepts/` (dev, 11) | your receipts; the solver was tuned on these | full breakdown (items, taxes, …) |
| `datasets/sroie40` (40) | SROIE scans, used while tuning | company, date, total |
| `datasets/sroie-final40` (40) | SROIE scans, **never tune on these** | company, date, total |
| `reciepts-uploaded/reciepts` (31) | your own phone photos & screenshots (git-ignored) | full breakdown; `make_ground_truth.py` |
| `datasets/web` (13) | web images labelled "receipt" in `review.html` (images git-ignored) | full breakdown + invoice no., GSTIN, phone; `make_ground_truth.py` |

`python datasets/fetch_sroie.py` re-downloads the SROIE images (git-ignored).

## Preprocessing (OCR engines)

The **Preprocess** selector controls what happens before OCR (`lib/preprocess.js`):

- **crop to receipt**: OCR once, find where the text is, then crop the
  full-resolution photo to that region and OCR again. Small receipts in big
  phone photos get far more pixels per character.
- **+ contrast**: stretch levels and lift dark photos, only when the photo is
  dark or washed out (already well-exposed scans are left alone).
- **Deskew** is always on (`lib/ocr.js`): boxes are rotated by the dominant
  text angle before rows are formed, and rows follow local slope for curled paper.

`lab.html` is a console harness for trying preprocessing variants on a dataset
without the UI (`lab.run(name, opts, dataset)`, then `lab.report(name, dataset)`).

## Layout

```
bench/
  index.html, app.js     UI, runner, results matrix
  lib/ocr.js             PaddleOCR (v6 small/tiny, v5), deskew, row grouping, layout text
  lib/preprocess.js      crop-to-content second pass, adaptive contrast
  lib/solver.js          OCR lines → tags → items/totals, chosen by arithmetic
  lib/rows.js            item rows: name vs. numbers, qty / rate / amount from qty × rate = amount or the column headings
  lib/datetime.js        receipt date + time (labels, OCR glue, day/month order)
  lib/meta.js            invoice no., GSTIN/VAT/PAN/FSSAI, phones, address, table, staff, payment, printed counts
  lib/schema.js          output schema, prompt schema, normalisation
  lib/score.js           scoring vs. ground truth
  lib/audit.js           self-check (no ground truth needed; usable in production)
  engines/*.js           one plug-in per approach: { load(ctx), run(input, ctx), unload() }
```

Adding an engine: write `{ id, label, family, approxMB, load, run, unload }`
where `run` returns `{ result, raw, ocrText?, timings }`, and add it to
`engines/index.js`.

## Scoring

Per receipt: total (weight 3), items F1 (3; name similarity + exact amount),
subtotal, tax, date, merchant (1 each), only for fields the receipt actually has.
"Self-check ✓ → total right" shows how often the engine's own arithmetic check
passing means the total really is right. That decides whether the self-check can
gate a cheap engine before falling back to a heavier one.
