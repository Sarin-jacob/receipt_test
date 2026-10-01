// Baseline: PaddleOCR + the hand-written rule parser from test.html (copied
// verbatim below, then mapped to the bench schema). NOTE: its regexes were
// tuned on these same test receipts, so its scores here are optimistic.
import { plainText } from '../lib/ocr.js';

class UniversalReceiptParser {
  constructor() {
    this.dateRegex = /\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[\s,:\.-]+)?(\d{1,4}[/\.-]\d{1,2}[/\.-]\d{1,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i;
    this.timeRegex = /\b((?:2[0-3]|[01]?[0-9]|O|l)[:\.][0-5O][0-9O](?:[:\.][0-5O][0-9O])?(?:\s*[AP]M)?)\b/i;

    this.headerBlacklist = /invoice|receipt|bill|take\s*away|dine\s*in|table|order|customer|guest|welcome|copy|tax\s*invoice|terminal|cashier|server|merchant|transaction|approval|swiped|chip|contactless|credit|debit|purchase|card|approved|branch|attach\s*file|comments|history|print|paid/i;
    this.metadataBlacklist = /date|time|table|bill|cash|change|round|code|@|%\s*\d|qty|item\s*name|price|sub\s*total|grand\s*total|balance|due|paid|visa|mastercard|amex|discover|printed|come\s*again|thank|merchant|terminal|approval|swiped|tip|gratuity|tax|vat|gst|hst|cgst|sgst|igst|gstin|place\s*of\s*supply|terms|amount\s*in\s*words|rupee|only|cartwheel|saved|expires|loyalty|member|mrp|delivery|surge|coupon|proceed|checkout|remove|payment\s*details|bank\s*(?:code|name|acc)|contact\s*us|www\.|http|email|fax|tel|phone/i;
    this.discountKeywords = /discount|promo|off|coupon|voucher|save|less|single|member|cartwheel|loyalty/i;
    this.contactAndIdShield = /(?:\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\+\d{1,3}[-.\s]\d+|\b(?:fax|tel|phone|ph|mob|cell|pin|zip|po|p\.o\.|box|nr\.|no\.|id|table|tisch|st|ave|rd|dr|blvd|lane|colony|nagar)\b.?\s*\d+|\b\d{4,6}\b\s*(?:Grindelwald|Any\s*City|Tamil|India|NY|CA|MA|ST|TX|FL|WA|UK|USA|CHF|EUR)?)/i;

    // MULTI-CLASS FUZZY KEYWORD SCORING MATRIX
    this.signatures = {
      DIGITAL_APP_CART: ['my cart', 'bill details', 'mrp', 'delivery charges', 'surge charges', 'coupon discount', 'proceed', 'item total', 'to pay', 'blinkit', 'zepto', 'instacart', 'swiggy', 'zomato'],
      TAX_INVOICE_INDIA: ['gstin', 'cgst', 'sgst', 'igst', 'place of supply', 'tax invoice', 'hsn', 'sac', 'fbr pos', 'ntn', 'strn', 'fbrpos', 'fbr'],
      CHARGE_SLIP: ['merchant id', 'terminal id', 'swiped', 'chip', 'auth code', 'approval code', 'discover', 'visa', 'mastercard', 'amex', 'entry mode', 'card type'],
      GROCERY_SUPERMARKET: ['target', 'walmart', 'supermarket', 'grocery', 'produce', 'cartwheel', 'loyalty', 'saved off', 'mfrcpn', 'weight', 'lb', 'kg'],
      RESTAURANT_HOSPITALITY: ['table', 'server', 'guest', 'dine in', 'take away', 'gratuity', 'tip', 'cover', 'pax', 'berghotel', 'tisch', 'bar']
    };
  }

  // UNIVERSAL FLOAT PARSER WITH STRIKETHROUGH/FREE OVERRIDE
  parseUniversalFloat(str, textLine = '') {
    if (!str) return null;
    if (this.contactAndIdShield.test(textLine) && !/(?:subtotal|total|amount|price|cost|rate|amt|usd|rm|chf|eur|₹|\$)/i.test(textLine)) return null;

    // STRIKETHROUGH / FREE OVERRIDE: If line says "free" or "waived", zero out fee!
    if (/free|waived|incl\.|included|strikethrough/i.test(textLine) && /(?:delivery|shipping|packaging|charge|fee|bag)/i.test(textLine)) {
      return 0.00;
    }

    let clean = str.replace(/(?:CHF|EUR|RM\$?|USD\$?|INR|Rs\.?|₹|天|<|¥|\$)/ig, '').trim();
    if (/^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/.test(clean)) {
      if (clean.indexOf(',') !== -1 && clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else {
      clean = clean.replace(/,/g, '');
    }

    const match = clean.match(/(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const val = parseFloat(match[1]);
    
    if (Number.isInteger(val) && Math.abs(val) >= 100) {
      if (!/(?:\$|£|€|₹|RM|CHF|EUR|USD|00$|,00$|\.00$)/i.test(str) && !/(?:total|subtotal|amount|price)/i.test(textLine)) return null;
    }
    return val;
  }

  clusterSpatialLines(rawOcrItems) {
    const items = rawOcrItems.map(item => {
      let top = 0, left = 0, right = 0, bottom = 0;
      const pts = item.poly || item.points || item.box || [];

      if (Array.isArray(pts) && pts.length > 0) {
        if (Array.isArray(pts[0])) {
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          left = Math.min(...xs); right = Math.max(...xs);
          top = Math.min(...ys); bottom = Math.max(...ys);
        } else if (typeof pts[0] === 'number') {
          left = pts[0]; top = pts[1]; right = pts[2]; bottom = pts[3];
        }
      }

      return {
        text: (item.text || item.label || '').trim(),
        box: { top, left, right, bottom, width: right - left, height: bottom - top }
      };
    }).filter(i => i.text.length > 0);

    items.sort((a, b) => a.box.top - b.box.top);
    const lines = [];
    items.forEach(item => {
      const lastLine = lines[lines.length - 1];
      const overlapThreshold = Math.max(8, item.box.height * 0.55);

      if (lastLine && Math.abs(lastLine.y - item.box.top) < overlapThreshold) {
        lastLine.items.push(item);
        lastLine.maxHeight = Math.max(lastLine.maxHeight, item.box.height);
      } else {
        lines.push({ y: item.box.top, maxHeight: item.box.height, items: [item] });
      }
    });

    lines.forEach(line => {
      line.items.sort((a, b) => a.box.left - b.box.left);
      line.text = line.items.map(i => i.text).join(' ');
    });

    return lines;
  }

  // PASS 1: MULTI-CLASS FUZZY SCORING CLASSIFIER
  classifyAndExtractMetadata(lines) {
    const meta = {
      type: "ITEMIZED_STANDARD",
      enterprise: "Unknown Enterprise",
      date: "Not Found",
      time: "Not Found",
      taxId: null
    };

    const scores = { DIGITAL_APP_CART: 0, TAX_INVOICE_INDIA: 0, CHARGE_SLIP: 0, GROCERY_SUPERMARKET: 0, RESTAURANT_HOSPITALITY: 0 };

    lines.forEach((line, idx) => {
      const text = line.text.toLowerCase();
      
      // Evaluate against multi-class signature dictionary
      Object.keys(this.signatures).forEach(type => {
        this.signatures[type].forEach(keyword => {
          if (text.includes(keyword)) scores[type]++;
        });
      });

      if (meta.enterprise === "Unknown Enterprise" && idx < 6) {
        if (!this.metadataBlacklist.test(text) && !this.headerBlacklist.test(text) && !/\d/.test(text) && text.length > 2) {
          meta.enterprise = line.text;
        }
      }

      if (meta.date === "Not Found" && this.dateRegex.test(line.text)) {
        meta.date = line.text.match(this.dateRegex)[1].replace(/\./g, '/');
      }

      if (meta.time === "Not Found" && this.timeRegex.test(line.text)) {
        let rawTime = line.text.match(this.timeRegex)[1].replace(/O/ig, '0').replace(/l/g, '1');
        if ((rawTime.match(/\./g) || []).length === 1 && rawTime.indexOf(':') !== -1) rawTime = rawTime.replace('.', ':');
        meta.time = rawTime;
      }

      if (!meta.taxId && /GSTIN:?\s*([0-9A-Z]{15})/i.test(line.text)) {
        meta.taxId = line.text.match(/GSTIN:?\s*([0-9A-Z]{15})/i)[1];
      }
    });

    // Determine highest scoring receipt classification
    let bestType = "ITEMIZED_STANDARD", maxScore = 1;
    Object.keys(scores).forEach(type => {
      if (scores[type] > maxScore) { maxScore = scores[type]; bestType = type; }
    });
    meta.type = bestType;

    return meta;
  }

  // PASS 2 & 3: SPECIALIZED DIGITAL CART OR TABLE PARSING
  parseTableItems(lines, receiptType) {
    const items = [];
    const totalsBlock = { subtotal: null, tax: 0.0, tip: 0.0, discount: 0.0, rounding: 0.0, delivery: 0.0, surge: 0.0, grandTotal: null };

    // DIGITAL APP CART COMBINATORIAL SUBSET RECONCILER (Blinkit / Zepto / Instacart)
    if (receiptType === "DIGITAL_APP_CART") {
      const candidates = [];
      lines.forEach(line => {
        const text = line.text;
        const val = this.parseUniversalFloat(text, text);
        if (val === null) return;

        if (/mrp|item\s*total/i.test(text)) totalsBlock.subtotal = val;
        else if (/bill\s*total|to\s*pay|total\s*amount/i.test(text)) totalsBlock.grandTotal = val;
        else if (/delivery/i.test(text)) totalsBlock.delivery += val; // Will be 0.00 if "free" was written!
        else if (/surge|handling|small\s*cart/i.test(text)) totalsBlock.surge += val;
        else if (/discount|coupon|saved/i.test(text)) candidates.push({ type: 'discount', val: Math.abs(val), line: text });
      });

      // Combinatorial Reconciler: Test if adding/ignoring specific coupons balances declared Bill Total!
      let bestDiscount = 0.0;
      if (totalsBlock.grandTotal !== null && totalsBlock.subtotal !== null) {
        const target = Number((totalsBlock.subtotal + totalsBlock.delivery + totalsBlock.surge - totalsBlock.grandTotal).toFixed(2));
        candidates.forEach(c => {
          if (Math.abs(c.val - target) <= 0.50) bestDiscount = c.val; // Automatically selects the exact discount that balances the equation!
        });
        totalsBlock.discount = bestDiscount || (candidates.length > 0 ? candidates[0].val : 0.0);
      } else {
        totalsBlock.discount = candidates.reduce((s, c) => s + c.val, 0);
      }

      if (totalsBlock.grandTotal === null && totalsBlock.subtotal !== null) {
        totalsBlock.grandTotal = Number((totalsBlock.subtotal - totalsBlock.discount + totalsBlock.delivery + totalsBlock.surge).toFixed(2));
      }
      return { items: [], totalsBlock };
    }

    // STANDARD ITEMIZED / GST / GROCERY PARSER
    let tableTopY = 0, tableBottomY = Number.MAX_SAFE_VALUE;
    lines.forEach(line => {
      const text = line.text;
      if (/(?:item|description|qty|quantity)\b.*\b(?:rate|price|amount|cost|subtotal|amt)\b/i.test(text)) tableTopY = line.y;
      if (tableBottomY === Number.MAX_SAFE_VALUE && /^(?:sub\s*total|\bsubtotal\b|total\s*:|payment\s*details|bank\s*code|total\s*in\s*words|thanks\s*for)/i.test(text)) {
        if (line.y > tableTopY + 20) tableBottomY = line.y;
      }
    });

    lines.forEach(line => {
      const text = line.text;
      if (/entspricht|equivalent|in\s*(?:euro|eur|usd|gbp)/i.test(text)) return;

      const rawTokens = text.split(/\s+/);
      const numPrices = [];
      rawTokens.forEach(tok => {
        const val = this.parseUniversalFloat(tok, text);
        if (val !== null && val !== 0 && !/\d{6,}/.test(tok)) numPrices.push(val);
      });
      const lastPrice = numPrices.length > 0 ? numPrices[numPrices.length - 1] : null;

      if (/\b(?:tip|gratuity|srvc\s*chg)\b/i.test(text) && lastPrice !== null) { totalsBlock.tip += lastPrice; return; }
      if (/\b(?:tax|vat|gst|hst|cgst|sgst|igst)\b/i.test(text) && lastPrice !== null) { totalsBlock.tax += lastPrice; return; }
      if (/\b(?:rounding|round\s*off|adjustment)\b/i.test(text) && lastPrice !== null) { totalsBlock.rounding += (/-/.test(text) ? -lastPrice : lastPrice); return; }
      if (/^sub\s*total|\bsubtotal\b|\bnet\s*amount\b/i.test(text) && lastPrice !== null) { totalsBlock.subtotal = lastPrice; return; }
      if (/total|amount\s*due|balance\s*due|charge/i.test(text) && !/sub/i.test(text) && lastPrice !== null) { totalsBlock.grandTotal = lastPrice; return; }

      if (this.metadataBlacklist.test(text) || /saved\s+\d|cartwheel|loyalty|member\s*savings|\b\d+\s+ea\b|net\s+\$/i.test(text)) {
        if (this.discountKeywords.test(text) && lastPrice !== null) totalsBlock.discount += Math.abs(lastPrice);
        return;
      }

      if (line.y <= tableTopY || line.y >= tableBottomY) return;
      if (numPrices.length === 0 || /\b\d{6,}\b/.test(text)) return;

      let qty = 1, unitPrice = lastPrice, totalPrice = lastPrice, rawName = text;

      // FUZZY QUANTITY PATTERNS: Handles "3xapple", "somethingx1", "apple (2)", "2 @ 3.50"
      const inlineMatch = text.match(/(\d+)\s*(?:x|X|@|à)\s*(\d+[\.,]\d{2})(?:\s+(\d+[\.,]\d{2}))?/i);
      const attachedLead = text.match(/^(\d+)\s*[xX\*@à]\s*([A-Za-z0-9\s\-_.,]+)/);
      const attachedTrail = text.match(/([A-Za-z0-9\s\-_.,]+?)\s*[xX\*@à]\s*(\d+)(?:\s+|$)/);
      const bracketTrail = text.match(/([A-Za-z0-9\s\-_.,]+?)\s*[\(\[]\s*(\d+)\s*[\)\]]/);

      if (inlineMatch) {
        qty = parseInt(inlineMatch[1], 10);
        unitPrice = this.parseUniversalFloat(inlineMatch[2], text) || lastPrice;
        totalPrice = inlineMatch[3] ? (this.parseUniversalFloat(inlineMatch[3], text) || Number((qty * unitPrice).toFixed(2))) : Number((qty * unitPrice).toFixed(2));
        rawName = text.replace(/(\d+)\s*(?:x|X|@|à)\s*(\d+[\.,]\d{2})(?:\s+(\d+[\.,]\d{2}))?/i, '');
      } else if (attachedLead && parseInt(attachedLead[1], 10) < 100) {
        qty = parseInt(attachedLead[1], 10);
        rawName = attachedLead[2];
        if (numPrices.length > 1 && Math.abs((qty * numPrices[numPrices.length - 2]) - lastPrice) <= 0.05) {
          unitPrice = numPrices[numPrices.length - 2]; totalPrice = lastPrice;
        } else if (qty > 1) { totalPrice = lastPrice; unitPrice = Number((lastPrice / qty).toFixed(2)); }
      } else if (attachedTrail && parseInt(attachedTrail[2], 10) < 100) {
        qty = parseInt(attachedTrail[2], 10);
        rawName = attachedTrail[1];
        if (qty > 1) { totalPrice = lastPrice; unitPrice = Number((lastPrice / qty).toFixed(2)); }
      } else if (bracketTrail && parseInt(bracketTrail[2], 10) < 100) {
        qty = parseInt(bracketTrail[2], 10);
        rawName = bracketTrail[1];
        if (qty > 1) { totalPrice = lastPrice; unitPrice = Number((lastPrice / qty).toFixed(2)); }
      } else {
        const leadQtyMatch = text.match(/^(\d+)\s+([A-Za-z].*)/);
        if (leadQtyMatch && parseInt(leadQtyMatch[1], 10) < 100) {
          qty = parseInt(leadQtyMatch[1], 10);
          rawName = leadQtyMatch[2];
          const secondLast = numPrices.length > 1 ? numPrices[numPrices.length - 2] : null;
          if (secondLast !== null && Math.abs((qty * secondLast) - lastPrice) <= 0.05) {
            unitPrice = secondLast; totalPrice = lastPrice;
          } else if (qty > 1) { totalPrice = lastPrice; unitPrice = Number((lastPrice / qty).toFixed(2)); }
        }
      }

      const cleanName = rawName
        .replace(/(?:\d+[\.,]\d{2})/g, '')
        .replace(/(?:CHF|EUR|RM\$?|USD\$?|INR|Rs\.?|₹|天|<|¥|\$)/ig, '')
        .replace(/[\$€£₹@xX\-\.]+\s*$/, '')
        .trim();

      if (cleanName.length > 1 && !/^\d+$/.test(cleanName) && !/^(?:pcs|kgs|nos|box|ml|gm)$/i.test(cleanName)) {
        items.push({ name: cleanName, quantity: qty, unit_price: unitPrice, total_price: totalPrice });
      }
    });

    const reconciledItems = [];
    for (let i = 0; i < items.length; i++) {
      const curr = items[i], n1 = items[i + 1], n2 = items[i + 2];
      if (n1 && n2 && Math.abs((curr.total_price - n1.total_price) - n2.total_price) <= 0.05) {
        reconciledItems.push({ name: curr.name, quantity: curr.quantity, unit_price: curr.unit_price, total_price: curr.total_price });
        totalsBlock.discount += n1.total_price;
        i += 2;
      } else {
        reconciledItems.push(curr);
      }
    }

    return { items: reconciledItems, totalsBlock };
  }

  process(rawOcrItems) {
    const lines = this.clusterSpatialLines(rawOcrItems);
    const metadata = this.classifyAndExtractMetadata(lines);
    const { items, totalsBlock } = this.parseTableItems(lines, metadata.type);

    let calculatedSubtotal = items.reduce((sum, item) => sum + item.total_price, 0);
    calculatedSubtotal = Number(calculatedSubtotal.toFixed(2));

    if (items.length === 0 && (metadata.type === "CHARGE_SLIP" || metadata.type === "DIGITAL_APP_CART")) {
      calculatedSubtotal = totalsBlock.subtotal || totalsBlock.grandTotal || 0.0;
    }

    let grandTotal = totalsBlock.grandTotal;
    if (grandTotal === null) {
      grandTotal = Number((calculatedSubtotal - totalsBlock.discount + totalsBlock.tax + totalsBlock.tip + totalsBlock.rounding + totalsBlock.delivery + totalsBlock.surge).toFixed(2));
    }

    const expectedGrand = Number((calculatedSubtotal - totalsBlock.discount + totalsBlock.tax + totalsBlock.tip + totalsBlock.rounding + totalsBlock.delivery + totalsBlock.surge).toFixed(2));
    const discrepancy = Number((grandTotal - expectedGrand).toFixed(2));
    const isValid = Math.abs(discrepancy) <= 0.05;

    const output = {
      receipt_type: metadata.type,
      enterprise: metadata.enterprise,
      date: metadata.date,
      time: metadata.time,
      items: items,
      financials: {
        calculated_subtotal: calculatedSubtotal,
        extracted_subtotal: totalsBlock.subtotal,
        tax: totalsBlock.tax,
        discount: totalsBlock.discount,
        tip: totalsBlock.tip,
        rounding: totalsBlock.rounding,
        grand_total: grandTotal
      },
      financial_audit: {
        is_mathematically_valid: isValid,
        discrepancy: discrepancy,
        audit_notes: isValid ? ["✓ Accounting equation balanced perfectly."] : [`Equation mismatch: Expected Net $${expectedGrand}, read $${grandTotal}. Diff: $${discrepancy}`]
      }
    };

    if (metadata.taxId) output.tax_id_gstin = metadata.taxId;
    if (totalsBlock.delivery > 0 || totalsBlock.surge > 0) {
      output.financials.delivery_charges = totalsBlock.delivery;
      output.financials.surge_charges = totalsBlock.surge;
    }

    return output;
  }
}

const parser = new UniversalReceiptParser();

export default {
  id: 'rules',
  label: 'PaddleOCR + rules (test.html)',
  family: 'rules',
  approxMB: 16,
  async load(ctx) { await ctx.ocr(); },
  async run(input, ctx) {
    const t0 = performance.now();
    const boxes = await ctx.ocrBoxes(input);
    const t1 = performance.now();
    const { raw, result } = fromBoxes(boxes);
    return { raw, result, ocrText: plainText(boxes), timings: { ocrWait: t1 - t0, ocr: boxes.ocrMs, parse: performance.now() - t1 } };
  },
};

export function fromBoxes(boxes) {
  const rawItems = boxes.map(b => ({ text: b.text, poly: [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]] }));
  const out = parser.process(rawItems);
  const f = out.financials;
  return {
    raw: out,
    result: {
      merchant: out.enterprise === 'Unknown Enterprise' ? null : out.enterprise,
      date: out.date === 'Not Found' ? null : out.date,
      time: out.time === 'Not Found' ? null : out.time,
      items: out.items.map(i => ({ name: i.name, qty: i.quantity, unit_price: i.unit_price, total: i.total_price })),
      subtotal: f.extracted_subtotal ?? f.calculated_subtotal,
      discounts: f.discount ? [{ label: 'discount', amount: -Math.abs(f.discount) }] : [],
      charges: [
        ...(f.tip ? [{ label: 'tip', amount: f.tip }] : []),
        ...(f.rounding ? [{ label: 'rounding', amount: f.rounding }] : []),
        ...(f.delivery_charges ? [{ label: 'delivery', amount: f.delivery_charges }] : []),
        ...(f.surge_charges ? [{ label: 'surge', amount: f.surge_charges }] : []),
      ],
      taxes: f.tax ? [{ label: 'tax', amount: f.tax, inclusive: false }] : [],
      total: f.grand_total,
    },
  };
}
