"""Ground truth for the web images labelled "receipt" in labels.json.

Written by reading each image. Two labelled images are left out because they
show two different receipts side by side (3: Neo Welcome + Aaswad, 6: Bombay
Barbeque + Global Fusion), so there is no single right answer.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))


def it(name, qty, unit, total, discount=None):
    return {"name": name, "qty": qty, "unit": None, "unit_price": unit, "discount": discount, "total": total}


def T(label, rate, amount, incl=False):
    return {"label": label, "rate": rate, "amount": amount, "inclusive": incl}


def L(label, amount):
    return {"label": label, "amount": amount}


def R(file, kind, diff, merchant, date, total, items, subtotal=None, discounts=(), charges=(), taxes=(), time=None,
      number=None, tax_id=None, phone=None, payment=None, notes=()):
    return {"file": file, "source_type": kind, "difficulty": diff,
            "merchant": {"name": merchant, "phone": phone, "tax_id": tax_id},
            "document": {"number": number, "date": date, "time": time, "currency": "INR"},
            "items": items, "subtotal": subtotal, "discounts": list(discounts), "charges": list(charges),
            "taxes": list(taxes), "total": total, "payment": {"method": payment}, "notes": list(notes)}


receipts = [
    R("indian_gst/1408bd610f86.jpg", "photo_thermal_restaurant", 2, "Sri Krishna Veg Restaurant", "2017-07-01", 70,
      [it("MEDU WADA", 1, 65, 65)], 65, discounts=[L("Dis: @10%", -6.0)],
      taxes=[T("CGST @9%", 9, 5.31), T("SGST @9%", 9, 5.31)], time="06:56", number="3/T/3", tax_id="27AADFH5037M1Z6",
      phone="23867544",
      notes=["Item amounts are integers ('65'), summary amounts have decimals.", "Grand total 70 is rounded (69.62); no rounding line printed.",
             "'Net Total 59.00' is subtotal after discount, not the total.", "'1/1' = items/qty count."]),
    R("indian_gst/7754afcef908.jpg", "photo_thermal_handheld_thumb", 3, "Sukhdev Vaishno Dhaba", "2017-07-01", 749,
      [it("PRANTHA (SEASONAL)", 3, 60, 180), it("ALOO PYAAZ PRANTHA", 1, 55, 55), it("ALU PRANTHA", 1, 55, 55), it("DAL MAKHNI", 1, 150, 150),
       it("SWEET LASSI", 2, 60, 120), it("KINLEY WATER", 1, 22.1, 22.1), it("PLAIN ROTI", 1, 18, 18), it("KULLAD CHAI", 1, 35, 35)], 635.1,
      taxes=[T("Add S GST(9.000%)", 9, 57.16), T("Add C GST(9.000%)", 9, 57.16)], time="00:36:22", number="140", tax_id="06ABIFS3901K1Z3",
      phone="0130-2475585",
      notes=["First item name is half under a thumb; its numbers sit on the line ABOVE the name.", "Total 749.00 is rounded from 749.42 (no rounding line).",
             "Qty printed as '3.00'."]),
    R("indian_gst/b9467cf059da.jpg", "scan_thermal_small", 2, None, "2017-07-01", 89.6,
      [it("FRESH COFFEE", 2, 40, 80)], 80, taxes=[T("CGST @ 6.00", 6, 4.8), T("SGST @ 6.00", 6, 4.8)], time="13:46", number="459",
      tax_id="27ADWPS9536J1ZF", payment="cash",
      notes=["No merchant name printed (just 'Bill').", "'Net Food Amt Rs. 89.60' is the bill total; 'CASH 90.00' is the rounded amount paid.",
             "'CGST @ 6.00 on 80.00 4.80': the tax base 80.00 sits in the middle of the line.", "Rate printed as '40.0' (one decimal)."]),
    R("indian_gst/6b984c2136c8.jpg", "scan_thermal_large", 2, "Liquor Street", "2018-05-20", 1139,
      [it("Tandoori chicken", 1, 295, 309.75), it("Lasooni Dal Tadka", 1, 275, 288.75), it("HYDERABADI MURG BIRYANI", 1, 375, 393.75),
       it("Tandoori Roti all food less spicy", 2, 30, 63), it("Tandoori Roti", 1, 30, 31.5)], 1035,
      taxes=[T("CGST@2.5", 2.5, 25.89), T("SGST@2.5", 2.5, 25.89), T("S.Tax", None, 51.75)], time="22:55", number="IN001001259",
      tax_id="06AACCO6344G1ZJ", phone="0129-4360377",
      notes=["Line totals include 5% tax (295 → 309.75), so items don't add up to the subtotal (1035 = sum of qty × rate).",
             "'S.Tax 51.75' is an extra (questionable) tax line; it is in the total.", "'Total Qty: 6' printed above the subtotal.",
             "Registered name '(ODVJH Private Limited)' under the trade name."]),
    R("indian_gst/83f5bcc55fd4.jpg", "photo_thermal_lowres", 3, "Murugan Idli Shop", "2017-07-01", 88.5,
      [it("GHEE PONGAL", 1, 50, 50), it("COFFEE", 1, 25, 25)], 75, taxes=[T("CGST 9 9%", 9, 6.75), T("SGST 9 9%", 9, 6.75)], time="07:19",
      number="1", tax_id="33AITPM1981H1ZW",
      notes=["Qty glued to rate: '1 50.00'.", "'Ticket Total' = subtotal.", "'TOTAL ITEMS:2' printed after the total."]),
    R("indian_gst/ab9dd292e74f.jpg", "photo_thermal_stamped", 2, "Classic Fast Food", "2023-06-09", 1921,
      [it("ONION RAVA SADA", 1, 145, 145), it("GARLIC CHATNI", 1, 85, 85), it("PAV BHAJI", 4, 200, 800), it("CHEESE PAV BHAJI", 1, 235, 235),
       it("PAV (1PC)", 8, 20, 160), it("VEG PULAV", 1, 215, 215), it("FRESH LIME SODA", 2, 70, 140), it("CHAAS", 1, 50, 50)], 1830,
      taxes=[T("CGST @2.5% On 1830", 2.5, 45.75), T("SGST @2.5% On 1830", 2.5, 45.75)], time="22:01", number="25966",
      tax_id="27ABEPS5356E2ZH", phone="24096599",
      notes=["All item amounts are integers ('145'); summary has decimals.", "'Food Total 1921.50' then 'Total 1921' (rounded): the total is 1921.",
             "'8/19' = 8 items, 19 qty.", "Rubber stamp over the qty/rate columns."]),
    R("indian_gst/3026029de20e.jpg", "photo_thermal_long", 3, "The Bikers Cafe", "2018-05-10", 2653,
      [it("LADIES NIGHT SANGRIA", 2, None, 0), it("THAI GRILLED FISH", 1, None, 375), it("100 PIPERS (30 ML)", 5, None, 1275),
       it("EAGLE RIDERS TENDER LAMB CHOP", 1, None, 499)], 2149,
      charges=[L("Service Charge@10", 214.9), L("Round Off", 0.05)],
      taxes=[T("VAT @18.9%", 18.9, 240.97), T("CGST @2.5", 2.5, 24.04), T("SGST @2.5", 2.5, 24.04)], time="23:00:27", number="T3--1402",
      tax_id="06AAECT3668A1ZJ",
      notes=["Names wrap over 2-3 lines and split mid-word ('LADIES NIGH' / 'T SANGRIA').", "Only Qty and Amt columns (no rate).",
             "'GST@5% 48.08' is the sum of the CGST/SGST lines under it.", "'Total Qty: 9' above the subtotal.",
             "Tin No / S.Tax No are other registration numbers."]),
    R("indian_gst/a5fbdd484e07.jpg", "digital_invoice_a4", 2, "Happy Holidays", "2024-01-19", 29310,
      [it("Train Ticket Booking", 5, 1200, 6300), it("Hotel Booking", 3, 6500, 23010)], 25500,
      taxes=[T("IGST", None, 3810)], number="45", tax_id="26CORPP3939N1ZA", phone="+91 878 8789 8789",
      notes=["'Journey Date 10-Apr-2024' and check-in/out dates are not the invoice date.", "Customer phone 8769856787 is not the merchant's.",
             "Item descriptions continue over many lines (passengers, booking IDs)."]),
    R("indian_gst/b84518cf263d.png", "digital_invoice_annotated_lowres", 5, "Mascot", "2024-01-23", 365.93,
      [it("Origami Crane Necklace", 2, 75.99, 170.22), it("Bangle Bracelet", 2, 39.99, 89.58), it("Choker with Bead", 1, 14.54, 15.7),
       it("Choker with Gold Pendant", 1, 29.1, 31.43)], 276.94, discounts=[L("Discount", -1.34)],
      charges=[L("Shipping", 50), L("CGST On Shipping", 4.5), L("SGST On Shipping", 4.5)], taxes=[T("CGST", None, 15.66), T("SGST", None, 15.66)],
      number="#1012", tax_id="789456321", phone="+91 9891887754",
      notes=["Marketing illustration: tiny text with callout boxes over it.", "Template numbers don't add up (item amounts 306.93 vs Sub Total 276.94).",
             "'BILLED TO John Doe' is the customer."]),
    R("indian_gst/43aff1786790.jpg", "digital_invoice_fake", 2, "Kerala Mega Jackpot Lottery", "2024-12-31", 505000,
      [it("Series no", 1, 1, 0), it("Ref. No", 1, 1, 0), it("Ticket no", 1, 500000, 500000)], 500000,
      taxes=[T("SGST @ 0.5%", 0.5, 2500), T("CG8ST @ 0.5%", 0.5, 2500)], number="99663H / 2024-25",
      notes=["A scam 'lottery winner' document styled as a GST invoice; still a fine parsing test.", "Amounts like '00.00' and '500000' (no decimals) in totals.",
             "'Payable Amount by Winner 5000.00/-' is not the total."]),
    R("indian_gst/f30cd4bb7fe6.png", "digital_invoice_a4_dense", 4, "BRAND NAME (VASYERP)", "2024-09-06", 466500,
      [it("VFD", 20, 22321.43, 400500.13), it("black cake", 20, 190.48, 4000.08), it("cakeqewewqE56fgcgc", 20, 2678.57, 59999.97),
       it("transportation", None, None, 2000)], 416970.42, charges=[L("Round Off", -0.18)], taxes=[T("Tax Amount", None, 49529.76)],
      number="GRE2024072100059", tax_id="24AAGCC8118G2ZS", phone="+91-8780234389",
      notes=["Line totals include tax; subtotal is the taxable amount.", "Due date 06/10/2024 is not the invoice date (06/09/2024).",
             "A tax summary table repeats the tax amounts after the total.", "Customer mobile +91-9822507144 is not the merchant's."]),
    R("indian_gst/d4cd312be15b.png", "digital_receipt_monospace", 1, None, "2020-01-25", 10000,
      [it("Wiring Harness", 1, 10000, 10000)], 8130.08, taxes=[T("Tax", None, 1869.92)], time="19:50", number="DELHI-DELHI-1-123",
      tax_id="07AEVPG9380C1Z7", payment="cash",
      notes=["Item price is tax-inclusive (10,000 = 8,130.08 + 1,869.92).", "'Tax components' table after the total breaks the tax into CGST/SGST.",
             "Date '25-01-20' (D-M-Y)."]),
    R("indian_gst/a5024437e42b.jpg", "digital_invoice_a4_table", 2, "YOU Broadband India Limited", "2021-01-25", 848,
      [it("Plan Subscription Charges", None, 719, 848)], 719, taxes=[T("CGST 9%", 9, 64.5), T("SGST 9%", 9, 64.5)], number="BVR-20-21-070734",
      tax_id="24AABCB6062F1Z2", phone="+91 22 71134100",
      notes=["Merchant is on the right under 'From:'; the customer is on the left.", "Wide table: Basic Amt, Disc, Net Basic, CGST %/Amt, SGST %/Amt, IGST, Total Tax, Total Amount.",
             "Amount in words: 'Eight Hundred and Fourty Eight Rs.'"]),
]

with open(os.path.join(HERE, 'ground_truth.json'), 'w', encoding='utf-8') as f:
    json.dump({"schema_version": 1, "source": "Web images (DuckDuckGo search) labelled 'receipt' in labels.json; not ours to redistribute.",
               "receipts": receipts}, f, indent=1, ensure_ascii=False)
print('wrote', len(receipts))
