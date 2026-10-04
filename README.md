# Receipt Scan

Scan a receipt with your phone and get its items, totals, taxes, date, time and
GST details as structured data. OCR and parsing run in the browser, so photos
are never uploaded. Installable as an app, and works offline after the first scan.

- **Stable:** <https://sarin-jacob.github.io/receipt_test/>
- **Beta** (latest `main`): <https://sarin-jacob.github.io/receipt_test/beta/>

The scanner is `scan/` plus the parsing modules in `bench/lib/`. `bench/` also
compares other client-side approaches (small LLMs, vision models) against
hand-checked ground truth; see [bench/README.md](bench/README.md).

## Release channels

Both channels live on the `gh-pages` branch, published by
[.github/workflows/deploy.yml](.github/workflows/deploy.yml):

| Channel | Address | Updated when |
|---|---|---|
| stable | `/` | a `vX.Y.Z` tag is pushed |
| beta | `/beta/` | a push to `main` changes the scanner |

Cut a stable release from an up-to-date, clean `main`:

```bash
npm run release -- patch
```

`minor`, `major` or an exact version (`1.4.0`) also work. The script sets the
version in `package.json` and adds a `CHANGELOG.md` section from the commit
subjects, which you can edit before confirming. It then commits, tags and
pushes. The tag push deploys stable and creates the GitHub release.

The other scripts need Node 20+ and have no dependencies:

| Command | What it does |
|---|---|
| `npm run preview` | builds both channels into `dist/` and serves them at <http://localhost:8770/> |
| `npm run build` | builds the beta channel into `dist/` |
| `npm run deploy:beta` | deploys beta from your machine instead of Actions |
| `npm run deploy:stable` | deploys stable from your machine; HEAD must be a release tag |

The build copies only the scanner and the modules it imports. Module URLs carry
the build ID, so a deploy never mixes old and new files. A service worker
keeps the app, the OCR library and the model for offline use.

One-time setup: in Settings → Pages, set the source to the `gh-pages` branch, `/ (root)`.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You may use, change and share this for
non-commercial purposes: personal use, study, research, hobby projects, and
use by charities, schools, public research and government bodies. Commercial
use, including use by a business for its work, is not allowed without a
separate license from the author.

The license covers the code in this repository. It does not cover:

- receipt images or datasets, which belong to their owners;
- third-party libraries and models loaded at runtime (PaddleOCR.js, ONNX
  Runtime Web, the PP-OCR models; all Apache-2.0).
