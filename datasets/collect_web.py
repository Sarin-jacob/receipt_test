"""Collects receipt / invoice images from web image search for local testing.

Uses DuckDuckGo image search through the `ddgs` package (Google Images has no
usable public API and blocks scrapers). Results are deduplicated, filtered for
size and obvious templates, and written to datasets/web/<category>/ with a
manifest.json.

The images are other people's content: keep them local for testing, don't
commit or redistribute them (the images are git-ignored).

  pip install ddgs pillow
  python datasets/collect_web.py                       # all categories, 25 per query
  python datasets/collect_web.py --only indian_gst handwritten --per-query 40
  python datasets/collect_web.py --query "petrol pump bill india" --category indian_gst

Review: label every image as receipt / not / unsure, then drop the rejects.

  python datasets/collect_web.py --serve               # http://localhost:8766/review.html
  python datasets/collect_web.py --apply               # move "not" images to web/_rejected/

Re-running a collection skips everything already downloaded or rejected.
"""
import argparse, hashlib, io, json, os, re, sys, time, urllib.request
from datetime import datetime, timezone

try:
    from ddgs import DDGS
    from PIL import Image
except ImportError:
    sys.exit('pip install ddgs pillow')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'web')
MANIFEST = os.path.join(OUT, 'manifest.json')

QUERIES = {
    'indian_gst': [
        'restaurant bill gst india photo',
        'gst tax invoice printed receipt india',
        'kirana store bill india photo',
        'supermarket bill india dmart receipt',
        'petrol pump receipt india',
        'medical store bill india',
        'swiggy order bill receipt',
        'cgst sgst bill receipt photo',
        'thermal printer bill india hotel',
        'reliance smart bill receipt',
    ],
    'handwritten': [
        'handwritten bill india',
        'handwritten cash memo',
        'handwritten receipt photo',
        'kachha bill handwritten',
        'handwritten invoice photo',
        'handwritten estimate bill shop',
        'handwritten restaurant bill',
    ],
    'thermal_photo': [
        'crumpled grocery receipt photo',
        'supermarket receipt photo itemized',
        'restaurant receipt photo with tip',
        'pharmacy receipt photo',
        'faded thermal receipt',
    ],
    'app_screenshot': [
        'zepto order summary screenshot',
        'blinkit bill details screenshot',
        'swiggy instamart order details screenshot',
        'amazon order invoice screenshot',
        'uber eats receipt screenshot',
    ],
    'other_countries': [
        'german kassenbon foto',
        'ticket de caisse photo',
        'japanese receipt photo',
        'uk supermarket receipt vat',
        'malaysia receipt sst',
    ],
}

# Mostly blank templates, mockups and stock vectors, which aren't real receipts.
TEMPLATE_HINT = re.compile(r'template|format|sample|editable|blank|mockup|vector|clipart|freepik|shutterstock|'
                           r'dreamstime|alamy|istock|gettyimages|canva|generator|maker|\.svg', re.I)
MIN_SIDE = 400
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            return json.load(f)
    return {'images': [], 'seen_urls': [], 'hashes': []}


def save_manifest(m):
    os.makedirs(OUT, exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(m, f, indent=1, ensure_ascii=False)


def ahash(img):
    """8x8 average hash: catches the same picture re-encoded or resized."""
    g = img.convert('L').resize((8, 8))
    px = list(g.get_flattened_data() if hasattr(g, 'get_flattened_data') else g.getdata())
    avg = sum(px) / 64
    return ''.join('1' if p > avg else '0' for p in px)


def near_dup(h, hashes, max_bits=4):
    return any(sum(a != b for a, b in zip(h, o)) <= max_bits for o in hashes)


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if int(r.headers.get('Content-Length') or 0) > 15_000_000:
            raise ValueError('too large')
        return r.read()


def search(query, n, retries=3):
    for attempt in range(retries):
        try:
            return list(DDGS().images(query, max_results=n, safesearch='moderate'))
        except Exception as e:  # rate limits are common; back off
            wait = 10 * (attempt + 1)
            print(f'  search failed ({e}); retrying in {wait}s')
            time.sleep(wait)
    return []


def collect(category, query, per_query, m, keep_templates):
    seen = set(m['seen_urls'])
    hashes = m['hashes']
    added = 0
    results = search(query, per_query)
    print(f'[{category}] "{query}": {len(results)} results')
    for r in results:
        url = r.get('image')
        if not url or url in seen:
            continue
        seen.add(url)
        m['seen_urls'].append(url)
        meta = f"{url} {r.get('title', '')} {r.get('url', '')}"
        if not keep_templates and TEMPLATE_HINT.search(meta):
            continue
        try:
            data = fetch(url)
            img = Image.open(io.BytesIO(data))
            img.load()
            if img.mode == 'P':
                img = img.convert('RGBA')
        except Exception as e:
            print(f'  skip {url[:80]}: {e}')
            continue
        if min(img.size) < MIN_SIDE:
            continue
        h = ahash(img)
        if near_dup(h, hashes):
            continue
        sha = hashlib.sha1(data).hexdigest()[:12]
        ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}.get(img.format)
        if not ext:  # gif/bmp/etc: convert
            ext, buf = 'jpg', io.BytesIO()
            img.convert('RGB').save(buf, 'JPEG', quality=92)
            data = buf.getvalue()
        rel = f'{category}/{sha}.{ext}'
        os.makedirs(os.path.join(OUT, category), exist_ok=True)
        with open(os.path.join(OUT, rel), 'wb') as f:
            f.write(data)
        hashes.append(h)
        m['images'].append({
            'file': rel, 'category': category, 'query': query, 'image_url': url,
            'page_url': r.get('url'), 'source': r.get('source'), 'title': r.get('title'),
            'width': img.size[0], 'height': img.size[1],
            'collected_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        })
        added += 1
    save_manifest(m)
    return added


LABELS = os.path.join(OUT, 'labels.json')
REJECTED = os.path.join(OUT, '_rejected')


def prune(m):
    """Drop manifest entries whose file was deleted by hand."""
    before = len(m['images'])
    m['images'] = [i for i in m['images'] if os.path.exists(os.path.join(OUT, i['file']))]
    save_manifest(m)
    counts = {}
    for i in m['images']:
        counts[i['category']] = counts.get(i['category'], 0) + 1
    print(f"{len(m['images'])} images ({', '.join(f'{k}: {v}' for k, v in sorted(counts.items()))})"
          + (f'; dropped {before - len(m["images"])} deleted' if before != len(m['images']) else ''))


def apply_labels(m):
    """Moves images labelled "not" into web/_rejected/ (kept out of the dataset,
    and their URLs stay in seen_urls so they're never downloaded again)."""
    if not os.path.exists(LABELS):
        sys.exit(f'no labels yet: {LABELS}')
    with open(LABELS, encoding='utf-8') as f:
        labels = json.load(f)
    moved = 0
    for i in list(m['images']):
        if labels.get(i['file']) != 'not':
            continue
        src = os.path.join(OUT, i['file'])
        dst = os.path.join(REJECTED, i['file'])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(src):
            os.replace(src, dst)
            moved += 1
        m['images'].remove(i)
        m.setdefault('rejected', []).append(i)
    save_manifest(m)
    kinds = {}
    for v in labels.values():
        kinds[v] = kinds.get(v, 0) + 1
    print(f'labels: {kinds}; moved {moved} to {REJECTED}')


def serve(port):
    """Serves datasets/ (review.html + images) and saves labels from the page."""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
    from functools import partial

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith('/api/ping'):
                return self._reply(200, b'ok')
            return super().do_GET()

        def do_POST(self):
            if self.path != '/api/labels':
                return self._reply(404, b'not found')
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            try:
                labels = json.loads(body)
                assert isinstance(labels, dict) and all(v in ('receipt', 'not', 'unsure') for v in labels.values())
            except Exception:
                return self._reply(400, b'bad labels')
            with open(LABELS, 'w', encoding='utf-8') as f:
                json.dump(labels, f, indent=1, ensure_ascii=False)
            return self._reply(200, b'saved')

        def _reply(self, code, body):
            self.send_response(code)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=HERE))
    print(f'review at http://localhost:{port}/review.html  (labels -> {LABELS}; Ctrl+C to stop)')
    httpd.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', nargs='*', choices=sorted(QUERIES), help='categories to collect (default: all)')
    ap.add_argument('--per-query', type=int, default=25, help='search results to consider per query')
    ap.add_argument('--query', help='run one custom query instead of the built-in lists')
    ap.add_argument('--category', default='custom', help='category folder for --query')
    ap.add_argument('--keep-templates', action='store_true', help="don't skip template/stock-looking results")
    ap.add_argument('--serve', action='store_true', help='open the review page server (labels save to web/labels.json)')
    ap.add_argument('--port', type=int, default=8766)
    ap.add_argument('--apply', action='store_true', help='move images labelled "not" to web/_rejected/')
    ap.add_argument('--review', action='store_true', help='only prune manifest entries for deleted files')
    ap.add_argument('--delay', type=float, default=3.0, help='seconds between searches')
    a = ap.parse_args()

    m = load_manifest()
    if a.serve:
        return serve(a.port)
    if a.apply:
        return apply_labels(m)
    if not a.review:
        jobs = [(a.category, a.query)] if a.query else [(c, q) for c in (a.only or QUERIES) for q in QUERIES[c]]
        total = 0
        for n, (cat, q) in enumerate(jobs):
            total += collect(cat, q, a.per_query, m, a.keep_templates)
            if n < len(jobs) - 1:
                time.sleep(a.delay)
        print(f'added {total} images')
    prune(m)


if __name__ == '__main__':
    main()
