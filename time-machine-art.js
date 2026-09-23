/* Time machine art: every era is pixel art on a 200x160 buffer, drawn fresh each frame and
   crossfaded with an ordered dither, the way old consoles faded between rooms. */
(() => {
  const W = 200, H = 160, FY = 138;                                 // FY: where the floor / table starts
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

  function painter() {
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

  // ---------- the album cover, reduced to pixels ----------
  const cover = { ok: false, c32: null, c26: null, c10: null, avg: C("#b23a2a"), top: C("#3a2a4a"), bot: C("#1a1a2a") };
  function sampleCover(img, n) {
    const cv = document.createElement("canvas"); cv.width = cv.height = n;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, n, n);
    return new Uint32Array(g.getImageData(0, 0, n, n).data.buffer.slice(0));
  }
  function avgOf(arr, from, to) { let r = 0, g = 0, b = 0, k = 0; for (let i = from; i < to; i++) { const [R, G, B] = split(arr[i]); r += R; g += G; b += B; k++; } return RGB(r / k | 0, g / k | 0, b / k | 0); }
  function fallbackCover(seed) {
    const n = 32, a = new Uint32Array(n * n), h = hash(seed, 7);
    const pal = [C("#e8742a"), C("#f2b134"), C("#2f958b"), C("#d6453b"), C("#e8d7c0"), C("#3a2a4a")];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = pal[Math.floor(((x + y * (h * 3 + 1)) / 6 + h * 10)) % pal.length];
    return a;
  }
  function resize(src, sn, n) { const a = new Uint32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = src[Math.floor(y * sn / n) * sn + Math.floor(x * sn / n)]; return a; }
  function setCoverFallback(seed) {
    cover.ok = false; cover.c32 = fallbackCover(seed); cover.c26 = resize(cover.c32, 32, 26); cover.c10 = resize(cover.c32, 32, 10);
    cover.avg = avgOf(cover.c32, 0, 1024); cover.top = shade(avgOf(cover.c32, 0, 512), .45); cover.bot = shade(avgOf(cover.c32, 512, 1024), .3);
  }
  function loadCover(url, seed) {
    setCoverFallback(seed);
    if (!url) return;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        cover.c32 = sampleCover(img, 32); cover.c26 = sampleCover(img, 26); cover.c10 = sampleCover(img, 10);
        cover.avg = avgOf(cover.c32, 0, 1024); cover.top = shade(avgOf(cover.c32, 0, 512), .45); cover.bot = shade(avgOf(cover.c32, 512, 1024), .3); cover.ok = true;
      } catch (e) { /* tainted: keep the fallback */ }
    };
    img.src = url;
  }
  setCoverFallback(1);

  // ---------- moving parts ----------
  const anim = { gram: 0, gramW: 0, lp: 0, lpW: 0, cd: 0, cdW: 0, crank: 0, hubL: 0, hubR: 0, t: 0, notes: [], skip: 0, noteAcc: 0 };
  function step(st) {
    const dt = st.dt, on = st.playing, ease = (w, target, tau) => w + (target - w) * (1 - Math.exp(-dt / tau));
    anim.t += dt;
    anim.gramW = ease(anim.gramW, on ? 7.8 : 0, .7); anim.gram += anim.gramW * dt * 2 * Math.PI / 6;   // 78 rpm, slowed for the eye
    anim.lpW = ease(anim.lpW, on ? 3.3 : 0, .7); anim.lp += anim.lpW * dt * 2 * Math.PI / 6;
    anim.cdW = ease(anim.cdW, on ? 1 : 0, .35); anim.cd += anim.cdW * dt * 9;
    if (on) anim.crank += dt * 1.1;
    anim.skip = Math.max(0, anim.skip - dt);
    // notes float up from whatever is making the sound
    const em = EMIT[st.era];
    if (on && em) { anim.noteAcc += dt * (.5 + st.level * 3); while (anim.noteAcc > 1) { anim.noteAcc -= 1; anim.notes.push({ x: em[0] + (Math.random() - .5) * em[2], y: em[1], age: 0, life: 2.4 + Math.random() * 1.4, k: Math.random() < .4 ? 1 : 0, ph: Math.random() * 6 }); } }
    for (const n of anim.notes) { n.age += dt; n.y -= dt * (9 + st.level * 6); }
    anim.notes = anim.notes.filter((n) => n.age < n.life && n.y > -8).slice(-24);
  }
  const EMIT = [[124, 44, 36], [100, 88, 26], [100, 44, 40], [150, 112, 30], [100, 70, 40], [130, 128, 12], [100, 56, 30]];
  const NOTE_C = [C("#e9d9a8"), C("#6b3c1c"), C("#1f6e66"), C("#f6d48a"), C("#f2c14e"), C("#3a82d8"), C("#c8b8ff")];

  // ---------- shared bits ----------
  function floor(P, c, hi, lo, seed) {
    P.rect(0, FY, W, H - FY, c); P.rect(0, FY, W, 1, hi);
    for (let y = FY + 7; y < H; y += 8) P.rect(0, y, W, 1, lo);
    for (let y = FY + 1; y < H; y += 8) for (let x = ((y * 7 + seed) % 23); x < W; x += 31 + ((y + seed) % 17)) P.rect(x, y, 1, 7, lo);
  }
  function shadow(P, cx, w) { P.ell(cx, FY + 1, w, 1.2, (x, y) => (bay(x, y) < 9 ? C("#000000") : null)); }
  function clock(P, cx, cy, r, face, rim, hand) {
    const d = new Date(), m = d.getMinutes() / 60 * Math.PI * 2 - Math.PI / 2, h = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2;
    P.ell(cx, cy, r, r, face, rim);
    P.line(cx, cy, cx + Math.cos(m) * (r - 2), cy + Math.sin(m) * (r - 2), hand);
    P.line(cx, cy, cx + Math.cos(h) * (r - 3.5), cy + Math.sin(h) * (r - 3.5), hand);
  }
  // a record seen edge-on: platter, disc, label, and a glint that travels round as it spins
  function flatRecord(P, cx, cy, rx, a, label) {
    P.ell(cx, cy, rx + 2, 2, C("#1c1c1c"));
    P.ell(cx, cy, rx, 1, C("#0c0c0c"));
    P.ell(cx, cy, 6, .6, label);
    const g = C("#707070"), g2 = C("#3c3c3c");
    P.px(cx + Math.cos(a) * rx * .72, cy + Math.sin(a) * 1.2, g); P.px(cx + Math.cos(a + .12) * rx * .72, cy + Math.sin(a + .12) * 1.2, g2);
    P.px(cx + Math.cos(a + Math.PI) * rx * .5, cy + Math.sin(a + Math.PI) * 1.2, g2);
    P.px(cx + Math.cos(a * 1) * 4, cy, shade(label, .45));
    P.px(cx, cy, C("#d0d0d0"));
  }

  // ---------- 1900 · the parlour ----------
  function parlour(P, st) {
    const wall = C("#2b3a29"), dam = C("#3b4d36"), dg = C("#8f7f45");
    P.rect(0, 0, W, 94, wall);
    for (let r = 0, y = 6; y < 92; y += 12, r++) for (let x = r % 2 ? 6 : 0; x < W + 6; x += 12) {
      P.px(x, y - 2, dam); P.rect(x - 1, y - 1, 3, 1, dam); P.rect(x - 2, y, 5, 1, dam); P.rect(x - 1, y + 1, 3, 1, dam); P.px(x, y + 2, dam); P.px(x, y, dg);
    }
    const wain = C("#4a2a16"), wk = C("#34190b"), whi = C("#6a3e22");
    P.rect(0, 92, W, 2, C("#8a5a30")); P.rect(0, 94, W, 1, wk); P.rect(0, 95, W, FY - 95, wain);
    for (let x = 4; x < W; x += 34) { P.frame(x, 100, 28, 33, wk); P.rect(x + 1, 101, 26, 1, whi); P.rect(x + 1, 101, 1, 31, whi); }
    floor(P, C("#3a1e0e"), C("#5a3218"), C("#2a1409"), 3);
    // portrait
    P.ell(30, 38, 11, 14, C("#c29a44"), C("#6a4c14"));
    P.ell(30, 38, 8, 11, C("#d8c9a4"));
    const sil = C("#3b2d1c"), frameIn = inEll(30, 38, 8, 11);
    P.ell(30, 34, 3, 4, sil);
    P.shape(20, 38, 40, 50, (x, y) => inEll(30, 47, 7, 6)(x, y) && frameIn(x, y), sil);
    P.px(23, 30, C("#fff0b8")); P.px(24, 28, C("#fff0b8"));
    // gramophone
    const wd = C("#7c4322"), wh = C("#a0602f"), wkk = C("#4a220e"), wo = C("#2a1206");
    const br = C("#c99b3d"), brH = C("#f3d68a"), brM = C("#a87c2c"), brD = C("#7a5418"), brK = C("#4a3210"), brX = C("#1e1507");
    shadow(P, 100, 36);
    P.poly([[120, 102], [124, 102], [129, 72], [119, 72]], br); P.rect(120, 76, 1, 26, brH);
    P.ell(124, 46, 30, 27, brH);
    P.ell(124, 46, 29, 26, br);
    P.ellD(124, 50, 26, 23, brM, .5); P.ell(124, 50, 24, 21, brM);
    P.ellD(124, 53, 21, 18, brD, .5); P.ell(124, 53, 19, 16, brD);
    P.ellD(124, 56, 15, 13, brK, .5); P.ell(124, 56, 13, 11, brK);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; P.line(124, 58, 124 + Math.cos(a) * 28, 46 + Math.sin(a) * 25, C("#6e4c16")); }
    P.ellD(124, 58, 8, 7, brX, .5); P.ell(124, 59, 6, 5, brX);
    for (let a = 3.5; a < 4.9; a += .05) P.px(124 + Math.cos(a) * 29.5, 46 + Math.sin(a) * 26.5, C("#fff4c8"));
    // box
    P.rect(73, 134, 5, 4, wo); P.rect(122, 134, 5, 4, wo);
    P.rect(70, 106, 60, 29, wd); P.frame(70, 106, 60, 29, wo);
    P.dith(71, 107, 3, 27, wh, .5); P.dith(126, 107, 3, 27, wkk, .7);
    P.frame(77, 111, 46, 19, wo); P.rect(78, 112, 44, 1, wh); P.rect(78, 112, 1, 17, wh);
    P.rect(96, 119, 8, 3, C("#e0b85a")); P.rect(96, 121, 8, 1, C("#9a7430"));
    P.poly([[73, 101], [127, 101], [130, 107], [70, 107]], wh, wo);
    flatRecord(P, 99, 104, 22, anim.gram, cover.avg);
    // soundbox and arm
    P.line(117, 100, 121, 101, br); P.line(117, 101, 121, 102, brD);
    P.ell(114, 99, 3, 3, C("#d8d8d8"), C("#5a5a5a")); P.px(114, 99, C("#8a8a8a")); P.px(113, 98, C("#ffffff"));
    P.line(112, 102, 111, 104, C("#e0e0e0"));
    // crank
    const ex = 132 + Math.cos(anim.crank) * 6, ey = 118 + Math.sin(anim.crank) * 6;
    P.rect(130, 117, 3, 2, C("#8a8a8a")); P.line(132, 118, ex, ey, C("#c8c8c8")); P.rect(ex - 1, ey - 1, 3, 3, wo);
  }

  // ---------- 1935 · art deco, a cathedral radio ----------
  function deco(P, st) {
    const cream = C("#d8c59c"), pin = C("#c8b385"), gold = C("#a67c32"), goldL = C("#efe2c2");
    P.rect(0, 0, W, FY, cream);
    for (let x = 3; x < W; x += 8) P.rect(x, 16, 1, FY - 16, pin);
    P.rect(0, 10, W, 1, gold); P.rect(0, 11, W, 3, goldL); P.rect(0, 14, W, 1, gold);
    for (let x = 0; x < W; x += 6) { P.px(x, 12, gold); P.px(x + 1, 11, gold); P.px(x + 1, 13, gold); }
    floor(P, C("#5a3a22"), C("#7a5234"), C("#43291a"), 11);
    // sunburst clock
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, r1 = 10, r2 = k % 2 ? 13 : 16; P.line(30 + Math.cos(a) * r1, 42 + Math.sin(a) * r1, 30 + Math.cos(a) * r2, 42 + Math.sin(a) * r2, gold); }
    clock(P, 30, 42, 8, goldL, gold, C("#3b2d1c"));
    // the radio
    const wd = C("#6b3c1c"), wh = C("#8f5a30"), wk = C("#3f210d"), wo = C("#241208"), trim = C("#b07a45");
    shadow(P, 100, 32);
    const body = (x, y) => (x >= 72 && x <= 127 && y >= 80 && y <= 135) || (y < 80 && inEll(99.5, 80, 27.5, 24)(x, y));
    P.shape(70, 54, 130, 136, body, (x, y) => (x <= 75 ? (bay(x, y) < 8 ? wh : wd) : x >= 124 ? wk : y < 66 && bay(x, y) < 4 ? wh : wd), wo);
    const t2 = (x, y) => (x >= 75 && x <= 124 && y >= 80 && y <= 132) || (y < 80 && inEll(99.5, 80, 24.5, 21)(x, y));
    const t3 = (x, y) => (x >= 76 && x <= 123 && y >= 80 && y <= 131) || (y < 80 && inEll(99.5, 80, 23.5, 20)(x, y));
    P.shape(72, 56, 128, 133, (x, y) => t2(x, y) && !t3(x, y), trim);
    // grille: cloth behind a gothic fret
    const warm = st.warm, glowOn = st.playing && st.level * warm > .5;
    const cloth = C("#3a2614"), cloth2 = glowOn ? C("#6b4524") : C("#4b331c"), bar = C("#a86d3c"), barL = C("#c88a52");
    const grille = (x, y) => (x >= 81 && x <= 118 && y >= 78 && y <= 104) || (y < 78 && inEll(99.5, 78, 18.5, 15)(x, y));
    const bars = [83, 84, 90, 91, 98, 99, 100, 101, 108, 109, 115, 116];
    const arch = (x, y) => y < 96 && inEll(99.5, 96, 19, 9)(x, y) && !inEll(99.5, 96, 18, 8)(x, y);
    P.shape(79, 60, 121, 105, grille, (x, y) => (bars.includes(x) ? (bars.includes(x - 1) ? bar : barL) : arch(x, y) ? bar : (x + y) & 1 ? cloth : cloth2), wo);
    // dial
    const g = warm * (.45 + .55 * st.level) * (st.playing ? 1 : .6);
    P.shape(88, 108, 112, 120, (x, y) => y <= 119 && inEll(100, 119, 10, 10)(x, y), C("#c28a4a"));
    P.shape(88, 108, 112, 120, (x, y) => y <= 118 && inEll(100, 119, 8.6, 8.6)(x, y), (x, y) => (bay(x, y) < g * 16 ? C("#ffcf72") : bay(x, y) < 4 + g * 12 ? C("#d08a30") : C("#8a5418")));
    for (let k = 1; k < 6; k++) { const a = Math.PI + k * Math.PI / 6; P.px(100 + Math.cos(a) * 7, 119 + Math.sin(a) * 7, C("#5a3008")); }
    const na = Math.PI * (1.62 + Math.sin(anim.t / 2.4) * .015);
    P.line(100, 119, 100 + Math.cos(na) * 8, 119 + Math.sin(na) * 8, C("#a01a0a"));
    // knobs
    const kb = C("#2a1a10"), kh = C("#6a4a30");
    P.ell(84, 127, 3, 3, kb, wo); P.px(83, 126, kh); P.px(84, 125, C("#d9b896"));
    P.ell(115, 127, 3, 3, kb, wo); P.px(114, 126, kh); P.px(115 + Math.round(Math.cos(na) * 2), 127 + Math.round(Math.sin(na) * 2), C("#d9b896"));
    P.ell(100, 129, 2, 2, kb, wo);
    P.rect(70, 135, 60, 3, wo);
  }

  // ---------- 1958 · mint and atomic, a suitcase record player ----------
  function atomic(P, st) {
    P.rect(0, 0, W, FY, C("#a9d8c6"));
    for (let y = 4; y < FY; y += 18) for (let x = (y / 18 & 1) ? 10 : 0; x < W; x += 20) {
      P.rect(x, y, 2, 2, C("#e2724a")); P.px(x + 10, y + 9, C("#f0b43c")); P.px(x + 11, y + 9, C("#f0b43c"));
      const q = C("#7fb3a3"); P.px(x + 15, y + 2, q); P.px(x + 14, y + 3, q); P.px(x + 16, y + 3, q); P.px(x + 15, y + 4, q);
    }
    floor(P, C("#b8693a"), C("#d88a5a"), C("#9a5530"), 5);
    // starburst clock
    const dk = C("#2d3a3a");
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + .2, r = k % 2 ? 12 : 15; P.line(26 + Math.cos(a) * 6, 28 + Math.sin(a) * 6, 26 + Math.cos(a) * r, 28 + Math.sin(a) * r, dk); P.ell(26 + Math.cos(a) * r, 28 + Math.sin(a) * r, 1, 1, k % 2 ? C("#f0b43c") : C("#e2724a")); }
    clock(P, 26, 28, 5, C("#f4ecd8"), dk, dk);
    // the player
    const teal = C("#2f958b"), tealH = C("#48b2a6"), tealD = C("#21766e"), to = C("#15504a"), cream = C("#efe6d2"), creamD = C("#d4c9ae"), gold = C("#e0bf5a"), goldD = C("#9a7a2a");
    shadow(P, 100, 46);
    P.poly([[66, 48], [134, 48], [139, 98], [61, 98]], (x, y) => (y < 52 && bay(x, y) < 8 ? tealH : teal), to);
    P.poly([[70, 52], [130, 52], [134, 95], [66, 95]], (x, y) => (y > 90 && bay(x, y) < 6 ? creamD : cream));
    P.ell(100, 72, 24, 15, gold, goldD);
    P.ell(100, 72, 22, 13, (x, y) => ((x + y) & 1 ? C("#d9ccb0") : C("#bba982")));
    P.rect(89, 69, 23, 7, C("#d9ccb0")); P.text("HI-FI", 91, 70, goldD);
    P.poly([[60, 98], [140, 98], [144, 106], [56, 106]], cream, C("#a89e84"));
    flatRecord(P, 98, 102, 24, anim.lp, cover.avg);
    P.ell(64, 103, 1, .6, gold); P.ell(69, 103, 1, .6, gold);
    P.ell(134, 101, 2, 1, C("#c8c8c8"), C("#7a7a7a"));
    P.line(132, 100, 117, 102, C("#e0e0e0")); P.line(132, 101, 117, 103, C("#9a9a9a")); P.rect(114, 101, 3, 2, C("#6a6a6a"));
    P.rect(56, 106, 88, 32, teal); P.dith(57, 126, 86, 10, tealD, .5); P.rect(57, 135, 86, 2, tealD); P.frame(56, 106, 88, 32, to);
    P.rect(57, 111, 86, 4, cream); P.rect(57, 114, 86, 1, creamD);
    P.rect(78, 107, 3, 4, gold); P.rect(119, 107, 3, 4, gold);
    P.text("STEREO", 100 - textW("STEREO") / 2, 121, gold);
    P.rect(58, 134, 2, 2, gold); P.rect(140, 134, 2, 2, gold);
  }

  // ---------- 1981 · panelling and stripes, a cassette player ----------
  function seventies(P, st) {
    P.rect(0, 0, W, FY, C("#6b4527"));
    for (let x = 6; x < W; x += 14) P.rect(x, 0, 1, FY, C("#553520"));
    for (let i = 0; i < 90; i++) P.px(hash(i, 3) * W, hash(i, 4) * FY, C("#7a5230"));
    P.rect(0, 44, W, 3, C("#d6453b")); P.rect(0, 47, W, 3, C("#e8742a")); P.rect(0, 50, W, 3, C("#f2b134")); P.rect(0, 53, W, 2, C("#f6d48a"));
    // shag
    P.rect(0, FY, W, H - FY, C("#8a6a3f")); P.rect(0, FY, W, 1, C("#a4824f"));
    for (let y = FY + 1; y < H; y++) for (let x = 0; x < W; x++) { const h = hash(x, y); if (h < .18) P.px(x, y, C("#735531")); else if (h > .9) P.px(x, y, C("#a0804e")); }
    // poster
    P.rect(158, 14, 26, 32, C("#f3e3c3")); P.rect(160, 16, 22, 20, C("#f6c453"));
    P.shape(160, 16, 181, 35, (x, y) => inEll(171, 34, 8, 8)(x, y) && y <= 35, C("#e8742a"));
    P.rect(160, 29, 22, 1, C("#f6c453")); P.rect(160, 32, 22, 1, C("#f6c453"));
    P.text("1981", 163, 39, C("#8a3b2a"));
    // headphones on the table, the cable running back to the player
    const steel = C("#c9ced3"), steelD = C("#8d959d"), foam = C("#e8742a"), foam2 = C("#c85c1a");
    shadow(P, 150, 26);
    P.shape(126, 106, 174, 132, (x, y) => y <= 130 && inEll(150, 130, 22, 22)(x, y) && !inEll(150, 130, 20, 20)(x, y), (x, y) => (y < 112 ? steel : steelD));
    P.line(126, 138, 114, 128, C("#1c1c1c"));
    for (const px of [128, 172]) { P.rect(px - 2, 125, 5, 11, C("#5a636c")); P.ell(px, 131, 7, 7, (x, y) => ((x + y * 2) % 3 === 0 ? foam2 : foam)); P.px(px - 3, 127, C("#f48c44")); }
    // the player
    const body = C("#a3adb7"), hi = C("#c9d1d8"), dk = C("#7d8894"), o = C("#4f5964");
    shadow(P, 86, 30);
    [63, 74, 85, 96].forEach((x, i) => { P.rect(x, 71, 10, 6, i === 2 ? C("#e8742a") : C("#d8dee3")); P.frame(x, 71, 10, 6, i === 2 ? C("#9a4414") : C("#6d7680")); });
    P.round(60, 76, 52, 62, 3, (x, y) => (x < 63 || y < 79 ? (bay(x, y) < 10 ? hi : body) : x > 108 || y > 133 ? dk : body), o);
    P.rect(112, 90, 2, 18, C("#6d7680")); for (let y = 91; y < 108; y += 2) P.px(113, y, C("#9aa3ab"));
    P.rect(64, 82, 44, 32, C("#1a2230"));
    P.rect(66, 84, 40, 28, C("#262626"));
    P.rect(68, 86, 36, 16, C("#efe6d2"));
    P.text("A", 70, 87, C("#5a4a3a")); P.text("C-60", 88, 87, C("#5a4a3a"));
    P.rect(68, 97, 36, 1, C("#d6453b")); P.rect(68, 98, 36, 1, C("#e8742a")); P.rect(68, 99, 36, 1, C("#f2b134"));
    // reels: tape runs at constant speed, so the thin reel spins fast and the fat one slow
    P.round(75, 91, 22, 6, 2, C("#0c0c0c"));
    const RMIN = 2, RMAX = 6, p = st.p, rL = Math.sqrt(RMIN * RMIN + (RMAX * RMAX - RMIN * RMIN) * (1 - p)), rR = Math.sqrt(RMIN * RMIN + (RMAX * RMAX - RMIN * RMIN) * p);
    if (st.playing) { anim.hubL -= st.dt * 16 / rL; anim.hubR -= st.dt * 16 / rR; }
    const win = inRound(75, 91, 22, 6, 2);
    for (const [cx, r, a] of [[80, rL, anim.hubL], [92, rR, anim.hubR]]) {
      P.shape(cx - 7, 88, cx + 7, 100, (x, y) => win(x, y) && inEll(cx, 94, r, r)(x, y), C("#3b2a1c"));
      P.rect(cx - 1, 93, 3, 3, C("#eeeeee")); P.px(cx + Math.round(Math.cos(a)), 94 + Math.round(Math.sin(a)), C("#8a8a8a"));
    }
    P.poly([[76, 111], [79, 105], [93, 105], [96, 111]], C("#383838"));
    P.text("STEREO", 64, 118, C("#39424c"));
    P.rect(103, 118, 2, 2, st.playing ? (st.level > .55 ? C("#ff6a4c") : C("#e0321c")) : C("#5a1a14"));
    P.rect(64, 127, 44, 1, C("#8d97a1"));
  }

  // ---------- 1995 · memphis confetti, a portable CD player ----------
  function nineties(P, st) {
    P.rect(0, 0, W, FY, C("#2e5760"));
    for (let y = 6; y < FY; y += 22) for (let x = (y / 22 & 1) ? 13 : 0; x < W; x += 26) {
      P.rect(x, y, 2, 2, C("#f2c14e")); P.rect(x + 13, y + 11, 2, 2, C("#e45d8c"));
      const q = C("#6ec6ca"); P.px(x + 6, y + 16, q); P.px(x + 7, y + 15, q); P.px(x + 8, y + 16, q); P.px(x + 9, y + 15, q); P.px(x + 10, y + 16, q);
    }
    P.rect(0, FY, W, H - FY, C("#1c262c")); P.rect(0, FY, W, 1, C("#2c3a42"));
    // lava lamp, glowing
    for (let r = 16; r > 4; r -= 3) P.ellD(27, 112, r, r + 4, C("#5a4a50"), .12 + (16 - r) / 60);
    const blobT = anim.t;
    P.poly([[24, 90], [30, 90], [32, 100], [22, 100]], C("#b9c2c8"), C("#7a848a"));
    P.poly([[22, 100], [32, 100], [34, 126], [20, 126]], C("#7a3fa8"));
    const glass = inPoly([[22, 100], [32, 100], [34, 126], [20, 126]]);
    for (const [ox, sp, r, ph] of [[27, .7, 3, 0], [26, .45, 2, 2], [28, .9, 2, 4]]) { const y = 116 - (Math.sin(blobT * sp + ph) * .5 + .5) * 14; P.shape(20, 98, 34, 127, (x, yy) => glass(x, yy) && inEll(ox, y, r, r + 1)(x, yy), C("#ff8a3d")); }
    P.poly([[20, 126], [34, 126], [36, 138], [18, 138]], C("#b9c2c8"), C("#7a848a"));
    // the player
    const body = C("#c7cdd3"), hi = C("#e6eaee"), dk = C("#949ca4"), o = C("#5c646c");
    shadow(P, 100, 38);
    P.rect(94, 63, 12, 4, dk);
    P.round(64, 66, 72, 72, 22, (x, y) => (x + y < 64 + 66 + 30 ? (bay(x, y) < 10 ? hi : body) : x + y > 136 + 138 - 40 ? (bay(x, y) < 8 ? dk : body) : body), o);
    P.ring(100, 98, 27, 27, dk);
    P.ell(100, 98, 25, 25, C("#0b0e13"));
    // the disc: the cover, printed on it, turns under a rainbow that stays with the light
    const a = anim.cd, ca = Math.cos(a), sa = Math.sin(a), art = cover.c32;
    const RAIN = [C("#ff6b6b"), C("#ffc371"), C("#7cf0a0"), C("#6ec6ff"), C("#c38bff")];
    P.shape(76, 74, 124, 122, inEll(100, 98, 23, 23), (x, y) => {
      const dx = x - 100, dy = y - 98, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 2.5) return C("#0b0e13");
      if (d < 7) return d < 5 ? C("#9aa6b2") : C("#d7dee6");
      if (d > 22) return C("#e3e9ef");
      const u = (dx * ca + dy * sa) / 22, v = (-dx * sa + dy * ca) / 22;
      let c = art[Math.min(31, Math.max(0, Math.floor((v * .5 + .5) * 32))) * 32 + Math.min(31, Math.max(0, Math.floor((u * .5 + .5) * 32)))];
      const ang = Math.atan2(dy, dx);
      if (ang > -2.6 && ang < -1.7 && d > 9 && (x + y) & 1) c = RAIN[Math.min(4, Math.floor((d - 9) / 2.8))];
      else if (ang > .55 && ang < 1.3 && d > 11 && bay(x, y) < 3) c = RAIN[Math.min(4, Math.floor((d - 11) / 2.4))];
      return c;
    });
    P.px(84, 82, C("#ffffff")); P.px(85, 81, C("#ffffff")); P.px(86, 80, C("#dfe8f0"));
    P.rect(83, 127, 34, 9, C("#a9bb9e")); P.frame(83, 127, 34, 9, o);
    const s = Math.max(0, Math.floor(st.cur)), lcd = `${String(st.trackNo).padStart(2, "0")} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    P.text(lcd, 100 - textW(lcd) / 2, 129, C("#27351f"));
    P.rect(70, 129, 9, 3, dk); P.rect(121, 129, 9, 3, dk);
  }

  // ---------- 2005 · white, clean, an MP3 player ----------
  function noughties(P, st) {
    P.vgrad(0, 0, W, FY, C("#ededea"), C("#dfdfdb"));
    P.rect(0, FY, W, H - FY, C("#d4d4d0")); P.rect(0, FY, W, 1, C("#f2f2ef")); P.dith(0, FY + 1, W, 4, C("#e2e2de"), .5);
    // print
    P.rect(16, 22, 36, 28, C("#ffffff")); P.frame(16, 22, 36, 28, C("#cfcfcb"));
    P.rect(19, 25, 30, 22, C("#f3f1ec"));
    P.ell(28, 34, 6, 6, C("#7cc4e8")); P.rect(33, 29, 12, 12, C("#f08a5d")); P.rect(21, 44, 26, 1, C("#1b1b1b"));
    P.dith(17, 50, 36, 2, C("#c8c8c4"), .5);
    // earbuds, the cable along the desk
    const wht = C("#fafaf8"), edge = C("#c8c8c4");
    P.line(100, 138, 118, 140, C("#e6e6e2")); P.line(118, 140, 124, 139, C("#e6e6e2")); P.line(118, 140, 128, 143, C("#e6e6e2"));
    P.ell(126, 139, 3, 2, wht, edge); P.ell(131, 143, 3, 2, wht, edge);
    // the player
    shadow(P, 100, 22);
    P.round(82, 72, 36, 66, 4, (x, y) => (x < 85 ? C("#ffffff") : x > 114 ? C("#e2e2de") : C("#f4f4f2")), C("#b8b8b4"));
    P.dith(84, 74, 14, 20, C("#ffffff"), .35);
    P.rect(86, 76, 28, 22, C("#1d1d1d"));
    P.rect(87, 77, 26, 20, C("#f6f7f8")); P.rect(87, 77, 26, 3, C("#dfe3e8"));
    P.blit(cover.c10, 10, 10, 88, 81);
    P.rect(100, 82, 11, 1, C("#222222")); P.rect(100, 85, 9, 1, C("#777777")); P.rect(100, 88, 7, 1, C("#aaaaaa"));
    P.rect(88, 93, 24, 2, C("#dcdfe3")); P.rect(88, 93, Math.round(24 * st.p), 2, C("#3a82d8"));
    P.ell(100, 118, 13, 13, C("#ebebe8"), C("#cfcfcb"));
    P.ell(100, 118, 5, 5, C("#fbfbf9"), C("#cfcfcb"));
    const m = C("#a8a8a4");
    P.rect(98, 107, 5, 1, m); P.rect(98, 128, 2, 2, m); P.rect(101, 128, 1, 2, m); P.rect(103, 128, 1, 2, m);
    P.px(89, 117, m); P.px(88, 118, m); P.px(89, 119, m); P.px(111, 117, m); P.px(112, 118, m); P.px(111, 119, m);
  }

  // ---------- 2026 · dark, an LED strip, a phone ----------
  function now(P, st) {
    P.rect(0, 0, W, FY, C("#15171c"));
    for (let y = 7; y < 44; y++) P.dith(0, y, W, 1, C("#231d3a"), Math.max(0, .55 - (y - 7) / 60));
    P.rect(0, 6, W, 1, C("#a082ff")); for (let x = 2; x < W; x += 6) P.px(x, 6, C("#e0d8ff"));
    for (let y = 90; y < FY; y++) P.dith(0, y, 70, 1, C("#12303a"), (y - 90) / 200);
    P.rect(0, FY, W, H - FY, C("#0d0e12")); P.rect(0, FY, W, 1, C("#22242c"));
    // plant
    const l1 = C("#2f6b4a"), l2 = C("#3a7d57"), l3 = C("#24593c");
    P.poly([[26, 118], [10, 96], [8, 84], [20, 92]], l1); P.poly([[28, 118], [44, 92], [52, 86], [46, 100]], l2); P.poly([[27, 118], [24, 90], [30, 70], [33, 94]], l3);
    P.line(27, 118, 18, 96, l3); P.line(28, 118, 44, 96, l1);
    P.poly([[18, 118], [38, 118], [36, 138], [20, 138]], C("#d7d2c8"), C("#a8a298")); P.rect(17, 116, 22, 3, C("#e8e3d8"));
    // phone
    shadow(P, 100, 24);
    P.round(80, 48, 40, 90, 6, C("#0b0b0c"), C("#5a5a62"));
    P.rect(80, 58, 1, 70, C("#9a9aa4"));
    const scr = inRound(82, 50, 36, 86, 5);
    P.shape(82, 50, 118, 136, scr, (x, y) => (bay(x, y) < ((y - 50) / 86) * 16 ? cover.bot : cover.top));
    P.round(94, 53, 12, 4, 2, C("#000000"));
    P.blit(cover.c26, 26, 26, 87, 60);
    P.text(clipText(st.title, 7), 87, 90, C("#ffffff"));
    P.text(clipText(st.artist, 7), 87, 97, C("#a9a9b6"));
    const f = st.freq;
    for (let i = 0; i < 9; i++) {
      const v = f && st.playing ? f[Math.floor(3 + Math.pow(i / 9, 1.6) * 300)] / 255 : 0, h = 1 + Math.round(v * 7);
      P.rect(87 + i * 3, 112 - h, 2, h, C("#e8e8f0"));
    }
    P.rect(87, 115, 26, 1, C("#5a5a66")); P.rect(87, 115, Math.round(26 * st.p), 1, C("#ffffff"));
    const w = C("#ffffff");
    P.rect(91, 120, 1, 5, w); P.px(94, 120, w); P.rect(93, 121, 2, 1, w); P.rect(92, 122, 3, 1, w); P.rect(93, 123, 2, 1, w); P.px(94, 124, w);
    if (st.playing) { P.rect(98, 119, 2, 7, w); P.rect(102, 119, 2, 7, w); }
    else { for (let j = 0; j < 7; j++) P.rect(99, 119 + j, j < 4 ? j + 1 : 7 - j, 1, w); }
    P.rect(109, 120, 1, 5, w); P.px(106, 120, w); P.rect(106, 121, 2, 1, w); P.rect(106, 122, 3, 1, w); P.rect(106, 123, 2, 1, w); P.px(106, 124, w);
    P.rect(94, 131, 12, 1, C("#d0d0d8"));
    // a glossy floor: a faint reflection
    const b = P.b, bg = C("#15171c");
    for (let y = FY + 1; y < H; y++) { const sy = 2 * FY - y; for (let x = 78; x < 122; x++) if ((x + y) & 1 && bay(x, y) < 8) { const c = b[sy * W + x]; if (c !== bg) b[y * W + x] = shade(c, .28); } }
  }

  const SCENES = [parlour, deco, atomic, seventies, nineties, noughties, now];

  // ---------- compositing ----------
  function create(canvas) {
    const g = canvas.getContext("2d");
    const img = g.createImageData(W, H), out = new Uint32Array(img.data.buffer);
    const A = painter(), Bp = painter();
    return {
      loadCover,
      skip() { anim.skip = .5; },
      render(st) {
        step(st);
        SCENES[st.i](A, st);
        if (st.s > 0) {
          SCENES[st.i + 1](Bp, st);
          const th = st.s * 64;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; out[k] = B8[(y & 7) * 8 + (x & 7)] < th ? Bp.b[k] : A.b[k]; }
        } else out.set(A.b);
        // the CD skips: a few rows slip sideways
        if (anim.skip > 0 && st.era === 4) for (let y = 64; y < 138; y++) if (hash(y, Math.floor(anim.t * 30)) < .35) { const sh = Math.round((hash(y, 9) - .5) * 8), row = out.slice(y * W, y * W + W); for (let x = 0; x < W; x++) out[y * W + x] = row[Math.min(W - 1, Math.max(0, x - sh))]; }
        // notes
        const nc = NOTE_C[st.era];
        for (const n of anim.notes) {
          const fade = Math.min(1, n.age / .3, (n.life - n.age) / .8), x = Math.round(n.x + Math.sin(n.age * 2 + n.ph) * 3), y = Math.round(n.y);
          const rows = NOTES[n.k];
          rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "1" && bay(x + i, y + j) < fade * 16) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = nc; } });
        }
        g.putImageData(img, 0, 0);
      },
    };
  }

  window.TMArt = { W, H, create };
})();
