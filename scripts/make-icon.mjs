// Draws the app icon (a stick figure's head and shoulders on the brand blue) and writes src-tauri/icons/icon.ico.
// No image library: the picture is computed pixel by pixel and stored as uncompressed 32-bit bitmaps, which every
// Windows tool reads. Run again only when the icon should change: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';

const SIZES = [16, 24, 32, 48, 64, 256];
const BG = [2, 132, 199];
const INK = [15, 23, 42];
const FACE = [255, 255, 255];

const clamp = (v) => Math.max(0, Math.min(1, v));
/** Distance from point p to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Colour and coverage of one sample point in a 0..1 square. */
function sample(x, y) {
  // rounded square background
  const r = 0.2;
  const qx = Math.abs(x - 0.5) - (0.5 - r), qy = Math.abs(y - 0.5) - (0.5 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  if (outside > 0) return null;
  const line = 0.055;
  const head = Math.hypot(x - 0.5, y - 0.4);
  if (head < 0.2) {
    // eyes and smile
    if (Math.hypot(x - 0.43, y - 0.37) < 0.032 || Math.hypot(x - 0.57, y - 0.37) < 0.032) return INK;
    const smile = Math.abs(Math.hypot(x - 0.5, y - 0.38) - 0.1) < 0.02 && y > 0.44;
    return smile ? INK : FACE;
  }
  if (head < 0.2 + line) return INK;
  // body and arms
  if (segDist(x, y, 0.5, 0.64, 0.5, 0.98) < line / 2 + 0.01) return INK;
  if (segDist(x, y, 0.5, 0.74, 0.24, 0.9) < line / 2 + 0.005 || segDist(x, y, 0.5, 0.74, 0.76, 0.9) < line / 2 + 0.005) return INK;
  return BG;
}

function render(size) {
  const ss = size >= 64 ? 3 : 5; // samples per pixel side
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = Math.round(b / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(r / a); }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return px; // BGRA, top row first
}

/** One icon image: BITMAPINFOHEADER (height doubled), pixels bottom row first, then an empty AND mask. */
function dib(size) {
  const px = render(size);
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const rows = [];
  for (let y = size - 1; y >= 0; y--) rows.push(px.subarray(y * size * 4, (y + 1) * size * 4));
  const mask = Buffer.alloc((Math.ceil(size / 32) * 4) * size);
  return Buffer.concat([head, ...rows, mask]);
}

const images = SIZES.map((s) => ({ s, data: dib(s) }));
const dir = Buffer.alloc(6 + 16 * images.length);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(images.length, 4);
let offset = dir.length;
images.forEach(({ s, data }, i) => {
  const e = 6 + i * 16;
  dir[e] = s === 256 ? 0 : s;
  dir[e + 1] = s === 256 ? 0 : s;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(data.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
const out = path.resolve(import.meta.dirname, '../src-tauri/icons/icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([dir, ...images.map((i) => i.data)]));
console.log('wrote', out, `${offset} bytes`);
