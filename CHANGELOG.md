# Changelog

Stable releases of the receipt scanner. `npm run release` adds a section here
from the commit subjects; edit it before confirming.

## v1.0.0

First release of the scanner. Everything runs in the browser and photos are
never uploaded.

- Crop and clean up: automatic receipt corners, draggable corners, perspective
  correction, rotation, brightness, contrast and black & white.
- On-device OCR with PaddleOCR (PP-OCRv6 small, about 31 MB, downloaded once).
- Reads the merchant, date and time, items with quantity × rate, subtotal,
  discounts, charges, taxes (GST, CGST/SGST, VAT…), round-off and total.
- Receipt details: invoice or bill number, GSTIN/PAN/FSSAI/VAT numbers, phone,
  address, table, staff, payment method, card or UPI reference, and the item
  count printed on the receipt.
- Self-check: says whether the numbers add up, so you know when to look again.
- Copy everything as JSON.
- Installable as an app; works offline after the first scan.
