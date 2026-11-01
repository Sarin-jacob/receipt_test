# Changelog

Stable releases of the receipt scanner. `npm run release` adds a section here
from the commit subjects; edit it before confirming.

## v1.1.0

Reads food and grocery app screenshots, and long scrolling ones.

- Blinkit, Swiggy and similar app orders, carts and bills: items at the price
  paid (not the struck-out MRP), fees, discounts and the total, without the
  app's buttons, banners and suggestions.
- The order's date and time, even when the app prints no year or no date:
  taken from the screenshot's file name and the phone's clock in it. Also the
  order id, and the app as the shop where none is named.
- Long scrolling screenshots are read in slices, so their text stays readable.
- Blurry, downscaled screenshots (e.g. forwarded on WhatsApp): prices that run
  together and ₹ signs read as digits are worked out from the bill's own sums.
- Amounts like "1,166" without a ₹ sign are read.
- Choose a saved photo or screenshot, not only take one with the camera.
- App screenshots are no longer cropped to their light panel, which cut off the
  shop name.

## v1.0.0 (2026-10-05)

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
