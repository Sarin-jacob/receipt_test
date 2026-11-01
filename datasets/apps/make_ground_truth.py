"""Ground truth for datasets/apps: Blinkit / Swiggy order summaries, checkouts and bills (phone
screenshots, mostly 1080x2400). Images are personal and git-ignored; this file and
ground_truth.json are kept.

Labelling rules (what the scanner should return for a split-the-bill app):
- Item amount = what was paid for the line: the second price when a struck-out MRP is shown
  next to it ("₹80 ₹60" -> 60).
- qty from "... x N" (Blinkit summary, Swiggy bill) or the "- N +" stepper (checkout / cart).
- Suggestions ("Complete your meal", "Popular"), savings banners ("₹126 saved ...") and coupon
  rows are not items or discounts.
- "Item total" is the subtotal. "MRP" (before product discounts) is not.
- A total cut off the screen is left out (None), so it isn't scored.
Run: python datasets/apps/make_ground_truth.py
"""
import json
from pathlib import Path


def item(name, total, qty=1):
    return {"name": name, "qty": qty, "unit": None, "unit_price": None, "discount": None, "total": total}


def receipt(file, kind, items, *, merchant=None, total=None, subtotal=None, charges=(), discounts=(), taxes=(),
            number=None, date=None, time=None, difficulty=2, notes=()):
    return {
        "file": file,
        "source_type": kind,
        "difficulty": difficulty,
        "merchant": {"name": merchant},
        "document": {"number": number, "date": date, "time": time, "currency": "INR"},
        "items": items,
        "subtotal": subtotal,
        "discounts": [{"label": l, "amount": a} for l, a in discounts],
        "charges": [{"label": l, "amount": a} for l, a in charges],
        "taxes": [{"label": l, "rate": None, "amount": a, "inclusive": False} for l, a in taxes],
        "total": total,
        "payment": {"method": None},
        "notes": list(notes),
    }


R = [
    receipt("blinkit-2025-10-16-22-59-45.jpg", "app_order_summary_dark", [
        item("Nestle Munch Max Choco Coated Crunchy Wafer Bar - Pack of 2", 60, 2),
        item("Nestle Munch Bites Coated Crunchy Wafer Bars", 61),
        item("epigamia Everyday Yogurt - Strawberry", 25),
        item("Vadilal Matka Kulfi", 55),
    ], subtotal=201, discounts=[("Flat ₹50 OFF", -50)], charges=[("Handling charge", 2), ("Delivery charges", 0)],
        time="22:47", notes=["Bill total is below the fold.", "'2 x 38 g x 2': pack of 2x38 g, qty 2.", "MRP 260 - product discount 59 = item total 201."]),
    receipt("blinkit-2025-10-19-19-10-38.jpg", "app_order_summary_dark", [
        item("Moreish Classic White Bread", 45),
        item("Amul Yummy Plain Cheese Spread", 104),
        item("Nestle Munch Bites Coated Crunchy Wafer Bars", 61),
        item("Britannia Treat Croissant - Cocoa Creme + Croissant with Vanilla Cr...", 35),
        item("On1y Pizza Oregano Mix", 84),
        item("epigamia Mishti Doi", 35),
    ], subtotal=364, charges=[("Handling charge", 5), ("Delivery charges", 0)], total=369),
    receipt("blinkit-2025-11-11-20-08-35.jpg", "app_checkout_dark", [
        item("Bajaj Almond Drops Non-Sticky Hair Oil 95 ml", 80),
        item("GM Surge Protector Power Strip, Type-C USB Extensio...", 799),
        item("Ambrane Twistand Mobile Stand (Black)", 199),
        item("Lifelong Men's Exercise Gym Gloves (Black)", 218),
        item("epigamia Everyday Yogurt - Strawberry", 25),
        item("Nestle Munch Max Choco Coated Crunchy Wafer Cho...", 30),
    ], total=1391, difficulty=3, notes=["Cart of 7 items, 6 visible; fees not shown. Total is on the Place Order button."]),
    receipt("blinkit-2025-11-24-19-17-05.jpg", "app_checkout_dark", [
        item("Chheda's Bhakarwadi Namkeen", 48),
        item("Wai Wai Chinese Hakka Egg Noodles", 39),
        item("Bikano Classic Salted Peanuts", 57),
        item("Sunfeast Farmlite Oats with Chocolate Cookies", 58),
        item("Haldiram's Prabhuji Moong Dal Namkeen", 56),
        item("Haldiram's Prabhuji Aloo Bhujia", 112),
    ], total=377, notes=["Items 370 + fees 7 = 377 (fees not shown)."]),
    receipt("blinkit-2026-03-05-21-09-31.jpg", "app_checkout_dark", [
        item("Sweet Karam Coffee Tapioca Chips - No Palm Oi...", 114),
        item("Dermatouch Kojic Acid 1% Syndet Soap", 135),
        item("Scotch Brite Sponge Scrub", 74),
        item("Pass Pass Minty Mix Mouth Freshener", 92),
        item("Godrej Fab Top Load Liquid Detergent Refill Pouch", 94),
        item("Colgate Total Anti-Tartar Toothpaste", 220),
    ], total=734, notes=["Items 729 + fees 5 = 734 (fees not shown)."]),
    receipt("blinkit-2026-03-05-21-32-49.jpg", "app_checkout_dark", [
        item("Godrej Aer Room Air Freshener Spray (Sandal Bl...", 99),
        item("Vim Lemon Dishwash Gel (900 ml)", 190),
        item("Santoor Classic Hand Wash with Sandalwood", 90),
        item("Freedom Refined Sunflower Oil", 169),
        item("Bajaj Almond Drops Non-Sticky Hair Oil 185 ml -...", 327),
        item("Clinic Plus Strong & Long Health Shampoo", 254),
        item("Saffola Classic-Masala Oats x 2 + Masala Veggie Twist ...", 69),
    ], total=2160, difficulty=3, notes=["List scrolled: more items above / below. Total on the Place Order button."]),
    receipt("swiggy-2024-04-04-15-17-29.jpg", "app_bill_light", [],
        subtotal=399, charges=[("Delivery Partner Fee", 0), ("Platform fee", 4)], taxes=[("GST and Restaurant Charges", 59.52)], total=463,
        notes=["Items are above the fold: none visible.", "Struck-out 30.00 / 5.00 are old prices.", "399 + 4 + 59.52 = 462.52, paid 463."]),
    receipt("swiggy-2025-09-30-19-35-32.jpg", "app_cart_light", [
        item("Plain Rice Mini+2 pcs Chicken Masala+Bhaja+Salad", 71),
        item("3Pcs Roti+Mix Veg+Dahi+Salad", 62),
    ], merchant="Spicy And Chilli Food Hub", total=155,
        notes=["'Complete your meal' (299 / 130 / 39 / 39) are suggestions, not items.", "Fees not shown; Pay ₹155."]),
    receipt("swiggy-2025-12-11-20-18-59.jpg", "app_cart_light", [
        item("Chicken Keema Paratha (2 Pieces)", 213, 2),
    ], merchant="The Chopsticks", charges=[("one extended at ₹1", 1)], total=251,
        notes=["Suggestions (269 / 149 / 129 / 248) are not items.", "'₹125 saved with FLAT125' is a coupon row."]),
    receipt("swiggy-2025-12-20-19-53-05.jpg", "app_cart_light", [
        item("Dahi Papad Chat", 49),
        item("Cholle Bhature", 56),
        item("Veg Tikki Cheese Burger", 78),
    ], merchant="Tiffin House", total=207,
        notes=["'To Pay ₹316.98 ₹207': struck-out pre-discount, then the amount."]),
    receipt("swiggy-2026-01-21-22-52-20.jpg", "app_bill_light", [
        item("2 Pcs Roti +2 pcs Chicken Hydrabadi+Salad", 129),
        item("Chicken Tikka", 230),
        item("Jira Rice Mini+2 pcs Chicken Kassa+Salad", 139),
    ], merchant="Spicy And Chilli Food Hub", subtotal=498, charges=[("Platform Fee", 14.99), ("Delivery Fee", 0)],
        discounts=[("Discount Applied", -205), ("Extra 10% off (with Swiggy One)", -29.29)], taxes=[("Taxes", 13.19)], total=292,
        number="227983399518906", time="22:31", notes=["'January 21' has no year.", "291.89 rounded to 292."]),
    receipt("swiggy-2026-01-21-22-52-35.jpg", "app_bill_light", [
        item("2 Pcs Roti +2 pcs Chicken Hydrabadi+Salad", 129),
        item("Chicken Tikka", 230),
        item("Jira Rice Mini+2 pcs Chicken Kassa+Salad", 139),
    ], merchant="Spicy And Chilli Food Hub", subtotal=498, charges=[("Platform Fee", 14.99), ("Delivery Fee", 0)],
        discounts=[("Discount Applied", -205), ("Extra 10% off (with Swiggy One)", -29.29)], taxes=[("Taxes", 13.19)], total=292,
        number="227983399518906", time="22:31", notes=["Same bill scrolled: 'BILL DETAILS' heading half hidden."]),
    receipt("whatsapp-20250916.jpg", "app_order_summary_lowres", [
        item("Pass Pass Minty Mix Mouth Freshener", 64),
        item("Salad Mix with Cherry Tomatoes", 57),
        item("Amul Taaza Toned Milk", 102, 6),
        item("Kenko by Ovo Farm Protein Rich Eggs", 125),
        item("Link 65 mm New Steel Round Pad Lock with 3 Keys (Silver)", 192),
        item("10on Lite Super Cocktail Napkins (1 Ply)", 39),
        item("Origami Klassic Toilet Roll (2 Ply)", 69),
        item("Jockey Men Cotton Crew length Socks (Jet Black, Foot Length(cm): ...", 169),
        item("Amul Spicy Garlic Cheese Spread", 114),
        item("Colgate Total Advanced Health Antibacterial Toothpaste", 160),
        item("Saffola Classic-Masala Oats - Pack of 4", 68),
    ], subtotal=1159, charges=[("Handling charge", 7), ("Delivery charges", 0)], total=1166, time="22:09", difficulty=3,
        notes=["Downscaled by WhatsApp to 270x1276: tiny text.", "'200 ml x 6' = qty 6 for ₹102.", "Arrived at 10:09 pm; placed 'yesterday, 9:50 PM'."]),
]

# Order dates. Screens print no year (or no date): carts are dated the day the screenshot was taken
# (the order is placed then); order pages by their own line ("Arrived at 10:47 pm" on the
# screenshot's day, "placed yesterday", "delivered on January 21"). The scanner reads the
# screenshot's day from its file name (Android: Screenshot_2025-10-16-22-59-45…).
DATES = {
    "blinkit-2025-10-16-22-59-45.jpg": "2025-10-16",
    "blinkit-2025-10-19-19-10-38.jpg": "2025-10-19",
    "blinkit-2025-11-11-20-08-35.jpg": "2025-11-11",
    "blinkit-2025-11-24-19-17-05.jpg": "2025-11-24",
    "blinkit-2026-03-05-21-09-31.jpg": "2026-03-05",
    "blinkit-2026-03-05-21-32-49.jpg": "2026-03-05",
    "swiggy-2024-04-04-15-17-29.jpg": "2024-04-04",
    "swiggy-2025-09-30-19-35-32.jpg": "2025-09-30",
    "swiggy-2025-12-11-20-18-59.jpg": "2025-12-11",
    "swiggy-2025-12-20-19-53-05.jpg": "2025-12-20",
    "swiggy-2026-01-21-22-52-20.jpg": "2026-01-21",
    "swiggy-2026-01-21-22-52-35.jpg": "2026-01-21",
    # Received on WhatsApp 2025-09-16 (screenshot clock 13:58), "placed yesterday".
    "whatsapp-20250916.jpg": "2025-09-15",
}
for r in R:
    r["document"]["date"] = DATES[r["file"]]

out = {
    "schema_version": 1,
    "source": "Personal Blinkit / Swiggy app screenshots (images git-ignored).",
    "receipts": R,
}
Path(__file__).with_name("ground_truth.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(R)} receipts")
