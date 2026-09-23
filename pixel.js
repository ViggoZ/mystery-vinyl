/* Pixel: a tiny painter for pixel art on a Uint32 buffer — shapes, ordered dither, a 3x5 font.
   Shared by the time machine and the window. Integer coordinates are pixel centres for ellipses,
   pixel edges for rects and polygons. */
(() => {
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bay = (x, y) => B4[(y & 3) * 4 + (x & 3)];                   // 0..15
  const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  const C = (hex) => { const n = parseInt(hex.slice(1), 16); return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16)) >>> 0; };
  const RGB = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const split = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
  const shade = (c, k) => { const [r, g, b] = split(c); return RGB(Math.min(255, r * k) | 0, Math.min(255, g * k) | 0, Math.min(255, b * k) | 0); };
  const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const inEll = (cx, cy, rx, ry) => (x, y) => { const dx = (x - cx) / (rx + .5), dy = (y - cy) / (ry + .5); return dx * dx + dy * dy <= 1; };
  const inPoly = (pts) => (x, y) => {
    const px = x + .5, py = y + .5; let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inRound = (x0, y0, w, h, r) => (x, y) => {
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - 1 - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - 1 - r);
    const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= (r + .3) * (r + .3);
  };

  // 3x5 pixel font, rows top to bottom
  const FONT = {
    0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
    5: "111100111001111", 6: "111100111101111", 7: "111001001010010", 8: "111101111101111", 9: "111101111001111",
    A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
    F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
    K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
    P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
    U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
    Z: "111001010100111", ":": "000010000010000", "-": "000000111000000", ".": "000000000000010", "/": "001001010100100",
    "'": "010010000000000", "&": "010101010101011", "!": "010010010000010", "?": "110001010000010", ",": "000000000010100", " ": "000000000000000",
  };
  const NOTES = [["00110", "00101", "00100", "11100", "11100"], ["011111", "010001", "010001", "110011", "110011"]];

  function painter(W, H) {
    const b = new Uint32Array(W * H);
    const P = {
      b,
      px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) b[y * W + x] = c; },
      rect(x, y, w, h, c) { x = Math.round(x); y = Math.round(y); const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h); for (let j = y0; j < y1; j++) b.fill(c, j * W + x0, j * W + x1); },
      frame(x, y, w, h, c) { P.rect(x, y, w, 1, c); P.rect(x, y + h - 1, w, 1, c); P.rect(x, y, 1, h, c); P.rect(x + w - 1, y, 1, h, c); },
      dith(x, y, w, h, c, level) { const t = level * 16; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (bay(i, j) < t) P.px(i, j, c); },
      vgrad(x, y, w, h, c0, c1) { for (let j = 0; j < h; j++) { const t = (j + .5) / h * 16; for (let i = x; i < x + w; i++) P.px(i, y + j, bay(i, y + j) < t ? c1 : c0); } },
      // fill every pixel inside test(); fill may be a colour or fn(x,y) -> colour | null; edge pixels get the outline
      shape(x0, y0, x1, y1, test, fill, outline) {
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
        const fn = typeof fill === "function";
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (!test(x, y)) continue;
          if (outline != null && (!test(x - 1, y) || !test(x + 1, y) || !test(x, y - 1) || !test(x, y + 1))) { b[y * W + x] = outline; continue; }
          const c = fn ? fill(x, y) : fill; if (c != null) b[y * W + x] = c;
        }
      },
      ell(cx, cy, rx, ry, fill, outline) { P.shape(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, inEll(cx, cy, rx, ry), fill, outline); },
      ellD(cx, cy, rx, ry, c, level) { const t = level * 16; P.ell(cx, cy, rx, ry, (x, y) => (bay(x, y) < t ? c : null)); },
      ring(cx, cy, rx, ry, c) { const a = inEll(cx, cy, rx, ry), i = inEll(cx, cy, rx - 1, ry - 1); P.shape(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => a(x, y) && !i(x, y), c); },
      poly(pts, fill, outline) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); P.shape(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1, inPoly(pts), fill, outline); },
      round(x, y, w, h, r, fill, outline) { P.shape(x, y, x + w, y + h, inRound(x, y, w, h, r), fill, outline); },
      line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let err = dx + dy;
        for (let n = 0; n < 400; n++) { P.px(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      },
      text(s, x, y, c) {
        s = String(s).toUpperCase();
        for (const ch of s) { const g = FONT[ch] ?? FONT[" "]; for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === "1") P.px(x + i, y + j, c); x += 4; }
      },
      blit(src, sw, sh, x, y) { for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) P.px(x + i, y + j, src[j * sw + i]); },
      sprite(rows, x, y, c) { rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "1") P.px(x + i, y + j, c); }); },
    };
    return P;
  }
  const textW = (s) => String(s).length * 4 - 1;
  const clipText = (s, n) => { s = String(s).toUpperCase().replace(/[^0-9A-Z:\-./'&!?, ]/g, ""); return s.length > n ? s.slice(0, n - 1).trimEnd() + "." : s; };

  window.Pixel = { B4, B8, bay, C, RGB, split, shade, hash, inEll, inPoly, inRound, FONT, NOTES, painter, textW, clipText };
})();
