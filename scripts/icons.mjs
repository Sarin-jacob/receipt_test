// App icons drawn in code, so the repo holds no binary files: a receipt on the
// accent colour. pngIcon(size) returns PNG bytes; svgIcon() is the same art as SVG.
import { deflateSync } from 'node:zlib';

const ACCENT = [0x35, 0x57, 0xd6], PAPER = [255, 255, 255], FAINT = [0xc9, 0xd3, 0xf5];

// Geometry in a 512 × 512 box. The receipt stays inside the maskable safe zone
// (a circle of radius 40% around the centre), so one drawing serves both kinds.
const L = 156, R = 356, TOP = 96, BOTTOM = 400, TOOTH = 22, TEETH = 5;
const receipt = [[L, TOP], [R, TOP], [R, BOTTOM]];
for (let i = 1; i <= TEETH * 2; i++) receipt.push([R - i * (R - L) / (TEETH * 2), BOTTOM + (i % 2 ? TOOTH : 0)]);
// [x, y, width, colour, height]: three item lines and a bold total.
const bars = [[192, 140, 128, FAINT, 18], [192, 182, 96, FAINT, 18], [192, 224, 112, FAINT, 18], [192, 292, 128, ACCENT, 28]];

const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inCapsule = (x, y, [bx, by, w, , h]) => {
  const r = h / 2, cx = Math.max(bx + r, Math.min(bx + w - r, x));
  return (x - cx) ** 2 + (y - by - r) ** 2 <= r * r;
};
const inRoundRect = (x, y, size, r) => {
  const cx = Math.max(r, Math.min(size - r, x)), cy = Math.max(r, Math.min(size - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function colourAt(x, y, maskable) {
  if (!maskable && !inRoundRect(x, y, 512, 112)) return null;
  let c = ACCENT;
  if (inPoly(x, y, receipt)) c = PAPER;
  for (const b of bars) if (inCapsule(x, y, b)) c = b[3];
  return c;
}

// Maskable icons are full-bleed squares (the launcher applies its own shape).
export function pngIcon(size, { maskable = false } = {}) {
  const SS = 4, scale = 512 / size, stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colourAt((px + (sx + 0.5) / SS) * scale, (py + (sy + 0.5) / SS) * scale, maskable);
        if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
      }
      if (!n) continue;
      const o = py * stride + 1 + px * 4;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
      raw[o + 3] = Math.round(255 * n / (SS * SS));
    }
  }
  return png(size, size, raw);
}

const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
export function svgIcon() {
  const rects = bars.map(([x, y, w, c, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${hex(c)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${hex(ACCENT)}"/>`
    + `<polygon points="${receipt.map(p => p.join(',')).join(' ')}" fill="#fff"/>${rects}</svg>\n`;
}

// Minimal PNG writer: 8-bit RGBA, rows already prefixed with filter byte 0.
const CRC = new Int32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n; });
const crc32 = buf => { let c = -1; for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, colour type RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
