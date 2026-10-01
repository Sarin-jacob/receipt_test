"""Re-creates the SROIE held-out sets used by the bench.

ICDAR2019 SROIE receipts (CC-BY-4.0) via the Voxel51/scanned_receipts mirror.
Only company / date / total are labelled, so the bench scores just those.

  sroie40/        40 random receipts (seed 42). Used while tuning the solver.
  sroie-final40/  40 different receipts (seed 7). Final test: never tune on it.

Usage:  python datasets/fetch_sroie.py
"""
import json, os, random, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://huggingface.co/datasets/Voxel51/scanned_receipts/resolve/main/'
MON = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}


def iso(s):
    s = (s or '').strip()
    m = re.match(r'^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$', s)
    if m:  # Malaysian receipts are D/M/Y
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        return f'{y + 2000 if y < 100 else y}-{b:02d}-{a:02d}'
    m = re.match(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$', s)
    if m:
        return f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}'
    m = re.match(r'^(\d{1,2})[-/ ]*([A-Za-z]{3})[A-Za-z]*[-/ ,]*(\d{2,4})$', s)
    if m and m[2].lower() in MON:
        y = int(m[3])
        return f'{y + 2000 if y < 100 else y}-{MON[m[2].lower()]:02d}-{int(m[1]):02d}'
    return None


def build(samples, folder, note):
    os.makedirs(os.path.join(HERE, folder), exist_ok=True)
    out = []
    for s in samples:
        fn = os.path.basename(s['filepath'])
        dst = os.path.join(HERE, folder, fn)
        if not os.path.exists(dst):
            urllib.request.urlretrieve(BASE + s['filepath'], dst)
        tot = re.sub(r'[^\d.]', '', s.get('total') or '')
        out.append({
            'file': fn, 'source_type': 'sroie_scan', 'difficulty': 2, 'items_unlabeled': True,
            'merchant': {'name': s.get('company')},
            'document': {'date': iso(s.get('date')), 'date_raw': s.get('date'), 'currency': 'MYR'},
            'items': [], 'subtotal': None, 'discounts': [], 'charges': [], 'taxes': [],
            'total': float(tot) if tot else None, 'notes': [note],
        })
    return out


def main():
    samples = json.load(urllib.request.urlopen(BASE + 'samples.json'))['samples']
    random.seed(42)
    tune = random.sample(samples, 40)
    used = {s['filepath'] for s in tune}
    random.seed(7)
    final = random.sample([s for s in samples if s['filepath'] not in used], 40)
    for folder, picked, source, note in [
        ('sroie40', tune, 'seed 42', 'SROIE label: company/date/total only'),
        ('sroie-final40', final, 'disjoint from sroie40, seed 7. Final test set: never tune on it.', 'SROIE label: company/date/total only. FINAL TEST SET: do not tune on these.'),
    ]:
        receipts = build(picked, folder, note)
        meta = {'schema_version': 1, 'source': f'ICDAR2019 SROIE via Voxel51/scanned_receipts (CC-BY-4.0), 40 random samples, {source}', 'receipts': receipts}
        with open(os.path.join(HERE, folder, 'ground_truth.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=1)
        print(folder, len(receipts))


if __name__ == '__main__':
    main()
