/* Rooftop cat — a one-button runner across a city at night, built on the record that's playing.
   The level is laid out on the song's beats (onsets detected live, tempo estimated from them), the far skyline is
   the song's spectrum, the moon pulses on the beat, and the sky takes its colour from the album cover. */
(() => {
  const { C, RGB, split, shade, bay, hash, inEll } = window.Pixel;
  const $ = (s) => document.querySelector(s);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mixC = (a, b, t) => { t = clamp(t); const [r1, g1, b1] = split(a), [r2, g2, b2] = split(b); return RGB(r1 + (r2 - r1) * t | 0, g1 + (g2 - g1) * t | 0, b1 + (b2 - b1) * t | 0); };
  const rnd = (a, b) => a + Math.random() * (b - a);

  const audio = $("#audio");
  const els = {
    cv: $("#game"), score: $("#score"), best: $("#best"), card: $("#card"), cardTitle: $("#card-title"), cardText: $("#card-text"), go: $("#go"),
    moods: $("#moods"), play: $("#play"), prev: $("#prev"), next: $("#next"), title: $("#title"), artist: $("#artist"), credit: $("#credit"), bpm: $("#bpm"),
  };

  // ---------- the screen: art pixels at a whole number of device pixels each ----------
  const g = els.cv.getContext("2d");
  let W = 240, H = 150, img, out, P, PX = 60, BASE = 116;
  function fit() {
    const vw = innerWidth, vh = innerHeight, dpr = window.devicePixelRatio || 1;
    let k = Math.min(Math.floor(vh * dpr / 150), Math.floor(vw * dpr / 200));
    if (k < 2) k = Math.min(vh * dpr / 150, vw * dpr / 200);
    W = Math.ceil(vw * dpr / k); H = Math.ceil(vh * dpr / k);
    els.cv.width = W; els.cv.height = H;
    els.cv.style.width = `${W * k / dpr}px`; els.cv.style.height = `${H * k / dpr}px`;
    img = g.createImageData(W, H); out = new Uint32Array(img.data.buffer); P = window.Pixel.painter(W, H);
    PX = Math.round(Math.min(W * .3, 90)); BASE = H - Math.max(26, Math.round(H * .2));
  }

  // ---------- the cat ----------
  const CAT = {
    run: [
      ["k..............k.k..", "k.............kkkkk.", ".k............kkkek.", "..k.gggggggggkkkkkk.", "...kkkkkkkkkkkkkk...", "...kkkkkkkkkkkkkk...", "...kk.........kk....", "..kk...........kk..."],
      [".k.............k.k..", ".k............kkkkk.", ".k............kkkek.", "..k.gggggggggkkkkkk.", "...kkkkkkkkkkkkkk...", "...kkkkkkkkkkkkkk...", ".....kk.....kk......", ".....k.......k......"],
      ["k..............k.k..", "k.............kkkkk.", ".k............kkkek.", "..k.gggggggggkkkkkk.", "...kkkkkkkkkkkkkk...", "...kkkkkkkkkkkkkk...", "....kk.......kk.....", "...kk.........k....."],
    ],
    jump: ["kk.............k.k..", "..k...........kkkkk.", "..k...........kkkek.", "...kgggggggggkkkkkk.", "...kkkkkkkkkkkkkk...", "..kkkkkkkkkkkkkkkk..", ".kk..............kk.", "k..................k"],
  };
  const CATC = { k: C("#34304a"), g: C("#c9c0ea"), e: C("#ffe07a") }, RIM = C("#8a82b0");
  // moonlight catches the cat's outline, so it reads against the dark roofs
  function drawCat(x, y, rows, flip) {
    const h = rows.length, at = (i, j) => j >= 0 && j < h && i >= 0 && i < rows[j].length && rows[j][i] !== ".";
    const Y = (j) => (flip ? y - j : y - h + j);
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (!at(i, j) && (at(i, j + 1) || at(i + 1, j) || at(i - 1, j))) P.px(x + i, Y(j), RIM); });
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch !== ".") P.px(x + i, Y(j), CATC[ch]); } });
  }

  // ---------- beats: onsets from the low end, tempo from their spacing ----------
  const beat = { P: 60 / 88, phase: 0, onsets: [], flux: [], prevLow: 0, lastOnset: -1, lastEst: 0, conf: 0, pulse: 0, lastBeatIdx: -1 };
  function clock() { return beat.fake ?? (audio.currentTime || 0); }     // beat.fake: a test clock (see ?debug)
  function detect(freq, t) {
    let low = 0; for (let i = 1; i <= 4; i++) low += freq[i];
    const flux = Math.max(0, low - beat.prevLow); beat.prevLow = low;
    beat.flux.push(flux); if (beat.flux.length > 50) beat.flux.shift();
    const m = beat.flux.reduce((a, b) => a + b, 0) / beat.flux.length, sd = Math.sqrt(beat.flux.reduce((a, b) => a + (b - m) * (b - m), 0) / beat.flux.length);
    if (flux > m + 1.4 * sd && flux > 10 && t - beat.lastOnset > .26) { beat.lastOnset = t; beat.onsets.push(t); if (beat.onsets.length > 60) beat.onsets.shift(); }
    if (t - beat.lastEst > 1.5) { beat.lastEst = t; estimate(t); }
  }
  // every gap between onsets votes for the periods it could be a multiple of; the best-supported period wins
  function estimate(t) {
    const on = beat.onsets.filter((x) => x > t - 12 && x <= t);
    if (on.length < 6) return;
    const lo = .4, hi = 1.0, step = .005, bins = new Float32Array(Math.round((hi - lo) / step) + 1);
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const d = on[j] - on[i]; if (d > 4) break;
      for (let m = 1; m <= 4; m++) { const p = d / m; if (p < lo || p > hi) continue; const b = (p - lo) / step; for (let o = -2; o <= 2; o++) { const k = Math.round(b) + o; if (k >= 0 && k < bins.length) bins[k] += Math.exp(-o * o / 2) / m; } }
    }
    let best = 0, bi = 0, sum = 0; for (let i = 0; i < bins.length; i++) { sum += bins[i]; if (bins[i] > best) { best = bins[i]; bi = i; } }
    const p = lo + bi * step, conf = best / (sum / bins.length + 1e-6);
    if (conf < 3) return;
    beat.P = Math.abs(p - beat.P) < .03 ? beat.P * .6 + p * .4 : p; beat.conf = conf;
    // phase: the circular mean of where the recent onsets fall in the bar
    let sx = 0, sy = 0; for (const x of on.slice(-16)) { const a = (x % beat.P) / beat.P * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
    beat.phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * beat.P + beat.P) % beat.P;
    els.bpm.textContent = `${Math.round(60 / beat.P)} BPM`;
  }
  const beatAt = (n) => beat.phase + n * beat.P;
  const beatIndex = (t) => Math.floor((t - beat.phase) / beat.P);

  // ---------- the run ----------
  const G = 560, JV = 150, HOLD = .6;
  const S = { mode: "title", dist: 0, v: 62, y: 0, vy: 0, ground: true, coyote: 0, buffer: 0, held: false, score: 0, recs: 0, combo: 0, anim: 0, dead: 0,
    roofs: [], obs: [], recs2: [], genX: 0, genBeat: 0, pops: [], dust: [], best: Math.floor(+(store.get("mv.rooftop.best") || 0)) };
  els.best.textContent = S.best;
  const worldX = () => S.dist + PX + 10;                                   // the cat's feet, in world pixels
  function reset() {
    S.dist = 0; S.v = 62; S.y = BASE; S.vy = 0; S.ground = true; S.score = 0; S.recs = 0; S.combo = 0; S.dead = 0; S.pops = []; S.dust = [];
    S.roofs = [{ x0: -400, x1: PX + 150, y: BASE }]; S.obs = []; S.recs2 = [];
    S.genX = PX + 150; S.genY = BASE; S.genBeat = beatIndex(clock()) + 2;
  }
  // lay the city out ahead, one roof at a time, gaps and chimneys on the song's beats
  function generate() {
    const now = clock(), here = worldX(), xAt = (n) => here + (beatAt(n) - now) * S.v;
    const hard = clamp(S.dist / 6000);
    while (S.genX < S.dist + W + 120) {
      let n = Math.max(S.genBeat, beatIndex(now) + 1);
      while (xAt(n) < S.genX + 50) n++;                                   // a roof is at least 50px long
      const beats = 3 + Math.floor(Math.random() * (5 - hard * 2));
      const edgeBeat = n + beats - 1, edge = xAt(edgeBeat) + 6;
      const roof = { x0: S.genX, x1: edge, y: S.genY };
      S.roofs.push(roof);
      // a jump lasts ~0.55s, so obstacles need 0.8s between them (and before the edge) to be jumpable on the beat
      let lastObs = -Infinity;
      for (let b = n + 1; b < edgeBeat; b++) {
        const bt = beatAt(b), bx = xAt(b), top = bx + S.v * (JV / G);     // where a jump on this beat peaks
        if (beatAt(edgeBeat) - bt < .8) continue;
        const r = Math.random();
        if (r < .3 + hard * .2 && bt - lastObs >= .8) { lastObs = bt; S.obs.push({ x: top - 3, w: Math.random() < .5 ? 5 : 7, h: Math.random() < .5 ? 8 : 6, y: roof.y, kind: Math.random() < .55 ? "chimney" : "ac" }); }
        else if (r < .62) S.recs2.push({ x: top, y: roof.y - (Math.random() < .7 ? 18 : 30), got: false, ph: Math.random() * 6 });
      }
      // the gap: never wider than a plain tap on the beat can clear, landing on a roof up to 9px higher
      const nextY = clamp(S.genY + Math.round(rnd(-9, 9)), BASE - 16, BASE + 8), rise = Math.max(0, S.genY - nextY);
      const tLand = (JV + Math.sqrt(JV * JV - 2 * G * rise)) / G;
      const gap = Math.round(Math.min(S.v * rnd(.22, .32 + hard * .08), S.v * tLand * .85 - 8));
      S.genX = edge + gap; S.genBeat = edgeBeat + 1; S.genY = nextY;
      if (Math.random() < .5) S.recs2.push({ x: edge + gap / 2, y: Math.min(roof.y, S.genY) - 22, got: false, ph: Math.random() * 6 });
    }
    const cut = S.dist - 60;
    S.roofs = S.roofs.filter((r) => r.x1 > cut); S.obs = S.obs.filter((o) => o.x + o.w > cut); S.recs2 = S.recs2.filter((r) => r.x > cut);
  }
  function roofUnder(x0, x1) { let best = null; for (const r of S.roofs) if (r.x1 >= x0 && r.x0 <= x1 && (!best || r.y < best.y)) best = r; return best; }
  function jump() {
    if (S.mode === "title" || S.mode === "over") { start(); return; }
    if (S.mode !== "run") return;
    S.buffer = .12; S.held = true;
  }
  function doJump() {
    S.vy = -JV; S.ground = false; S.coyote = 0; S.buffer = 0;
    // on the beat?
    const t = clock(), n = Math.round((t - beat.phase) / beat.P), off = Math.abs(t - beatAt(n));
    if (audio.paused === false && off < .09) { S.combo++; const b = 5 * S.combo; S.score += b; pop("PERFECT" + (S.combo > 1 ? ` x${S.combo}` : ""), C("#f2d36a")); blip(660 * Math.pow(2, [0, 2, 4, 7, 9][S.combo % 5] / 12), .05); }
    else S.combo = 0;
  }
  function pop(text, c) { S.pops.push({ text, c, x: PX + 2, y: S.y - 14, age: 0 }); }
  function die() {
    if (S.mode !== "run") return;
    S.mode = "over"; S.dead = 0; S.vy = -110;
    S.score = Math.floor(S.score);
    if (S.score > S.best) { S.best = S.score; store.set("mv.rooftop.best", String(S.best)); els.best.textContent = S.best; }
    blip(180, .08, "square");
    setTimeout(() => showCard("The cat slipped", `Score ${S.score} · best ${S.best}. The record keeps playing. Tap, click or press space to run again.`, "Run again"), 700);
  }
  function step(dt) {
    const now = clock();
    if (S.mode === "run") {
      S.v = 62 + Math.min(46, S.dist / 150);
      S.dist += S.v * dt;
      generate();
      // jumping and falling
      S.buffer = Math.max(0, S.buffer - dt); S.coyote = Math.max(0, S.coyote - dt);
      if (S.buffer > 0 && (S.ground || S.coyote > 0)) doJump();
      const prevY = S.y;
      if (!S.ground) { S.vy += G * (S.held && S.vy < 0 ? HOLD : 1) * dt; S.y += S.vy * dt; }
      const fx0 = worldX() - 6, fx1 = worldX() + 5, r = roofUnder(fx0, fx1);
      if (!S.ground && r && S.vy >= 0 && prevY <= r.y + 1 && S.y >= r.y) { S.y = r.y; S.vy = 0; S.ground = true; for (let i = 0; i < 4; i++) S.dust.push({ x: PX + 4 + i * 3, y: r.y, vx: rnd(-20, -5), vy: rnd(-20, -8), age: 0 }); }
      if (S.ground && (!r || r.y > S.y + 1)) { S.ground = false; S.coyote = .08; }
      if (S.ground && r && r.y < S.y - 3) die();
      // running into a taller roof's wall
      for (const w of S.roofs) if (w.x0 > worldX() - 2 && w.x0 < worldX() + 8 && w.y < S.y - 3) die();
      if (S.y > H + 12) die();
      // chimneys and records
      const cx0 = worldX() - 7, cx1 = worldX() + 7, cy0 = S.y - 7, cy1 = S.y;
      for (const o of S.obs) if (cx1 > o.x + 1 && cx0 < o.x + o.w - 1 && cy1 > o.y - o.h + 1) die();
      for (const rc of S.recs2) if (!rc.got && Math.abs(rc.x - worldX()) < 7 && rc.y > cy0 - 6 && rc.y < cy1 + 3) { rc.got = true; S.recs++; S.score += 10; pop("+10", C("#e8d7c0")); blip(880 * Math.pow(2, [0, 3, 5, 7, 10][S.recs % 5] / 12), .06); }
      S.score += S.v * dt * .02;
      els.score.textContent = Math.floor(S.score);
    } else if (S.mode === "over") {
      S.vy += G * dt; S.y += S.vy * dt; S.dead += dt;
    }
    // the beat, for the pulse
    const n = beatIndex(now);
    if (!audio.paused && n !== beat.lastBeatIdx) { beat.lastBeatIdx = n; beat.pulse = 1; }
    beat.pulse = Math.max(0, beat.pulse - dt * 3.2);
    S.anim += dt * (S.v / 9);
    for (const p of S.pops) { p.age += dt; p.y -= dt * 14; }
    S.pops = S.pops.filter((p) => p.age < .9);
    for (const d of S.dust) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 60 * dt; }
    S.dust = S.dust.filter((d) => d.age < .4);
  }

  // ---------- drawing ----------
  let tint = C("#6a4a9a");                                               // from the cover
  const STARS = Array.from({ length: 140 }, (_, i) => [hash(i, 1), hash(i, 2), hash(i, 3)]);
  function draw(freq, t) {
    const skyTop = mixC(C("#07081a"), tint, .18), skyHor = mixC(C("#2a2250"), tint, .45);
    const band = [skyTop, mixC(skyTop, skyHor, .33), mixC(skyTop, skyHor, .66), skyHor];
    for (let y = 0; y < H; y++) {
      const p = clamp(y / (BASE + 10)) * 3, i = Math.min(2, p | 0), f = p - i;
      for (let x = 0; x < W; x++) P.b[y * W + x] = bay(x, y) < f * 16 ? band[i + 1] : band[i];
    }
    for (const [a, b, c] of STARS) { const x = a * W | 0, y = b * BASE * .7 | 0; if (hash(x, Math.floor(t * 2 + c * 9)) > .15) P.px(x - Math.floor(S.dist * .02) % W, y, c < .2 ? C("#ffffff") : C("#8a90b8")); }
    // the moon, breathing on the beat
    const mx = Math.round(W * .76), my = Math.round(Math.min(H * .2, 30)), glow = mixC(skyHor, C("#fff2c8"), .35);
    P.ellD(mx, my, 13 + beat.pulse * 5, 13 + beat.pulse * 5, glow, .18 + beat.pulse * .3);
    P.ell(mx, my, 10, 10, C("#f4efd8")); P.ell(mx - 3, my - 2, 2, 2, C("#dcd6bc")); P.ell(mx + 3, my + 3, 1.5, 1.5, C("#dcd6bc")); P.px(mx + 4, my - 4, C("#dcd6bc"));
    // the far skyline is the spectrum: each tower is a band, its lit windows the level
    const far = mixC(skyHor, C("#141228"), .55), lit = mixC(C("#ffe09a"), tint, .25), litDim = mixC(lit, far, .55);
    const colW = 9, off = Math.floor(S.dist * .08);
    for (let i = -1; i < W / colW + 1; i++) {
      const wi = i + Math.floor(off / colW), x = i * colW - (off % colW), band = ((wi % 24) + 24) % 24;
      const v = freq ? freq[Math.floor(2 + Math.pow(band / 24, 1.7) * 180)] / 255 : .2 + .15 * Math.sin(t + band);
      const hgt = 18 + (hash(wi, 5) * 22 | 0), top = BASE - 10 - hgt;
      P.rect(x, top, colW - 1, H - top, far);
      const rows = Math.floor(hgt / 3), on = Math.round(v * v * rows * 1.3);
      for (let r = 0; r < rows; r++) { const yy = BASE - 12 - r * 3, c = r < on ? lit : litDim; if (r < on || hash(wi, r) > .8) { P.rect(x + 1, yy, 2, 2, c); P.rect(x + 5, yy, 2, 2, c); } }
    }
    // a nearer row, slower than the roofs
    const mid = mixC(skyHor, C("#0c0b18"), .78), mOff = Math.floor(S.dist * .3);
    for (let i = -1; i < W / 14 + 2; i++) {
      const wi = i + Math.floor(mOff / 14), x = i * 14 - (mOff % 14), hgt = 10 + (hash(wi, 9) * 20 | 0), top = BASE - hgt + 4;
      P.rect(x, top, 13, H - top, mid);
      for (let yy = top + 3; yy < H; yy += 4) for (let xx = x + 2; xx < x + 12; xx += 3) if (hash(xx + wi * 31, yy) > .78) P.px(xx, yy, mixC(C("#f6c46a"), mid, .35 - beat.pulse * .25));
    }
    // roofs
    const brick = C("#1c1a26"), brick2 = C("#221f2e"), ledge = C("#3c3850"), rim = C("#76708e"), win = C("#f2c46a");
    for (const r of S.roofs) {
      const x0 = Math.round(r.x0 - S.dist), x1 = Math.round(r.x1 - S.dist);
      if (x1 < 0 || x0 > W) continue;
      P.rect(x0, r.y, x1 - x0, H - r.y, brick);
      for (let yy = r.y + 3; yy < H; yy += 3) for (let xx = x0 + ((yy >> 1) % 2 ? 1 : 3); xx < x1; xx += 5) P.px(xx, yy, brick2);
      for (let yy = r.y + 6; yy < H - 2; yy += 7) for (let xx = x0 + 4; xx < x1 - 4; xx += 8) if (hash(xx + Math.round(r.x0), yy) > .55) { P.rect(xx, yy, 3, 3, win); P.px(xx + 1, yy + 1, mixC(win, brick, .3)); }
      P.rect(x0 - 1, r.y - 2, x1 - x0 + 2, 2, ledge); P.rect(x0 - 1, r.y - 2, x1 - x0 + 2, 1, rim);
      P.rect(x0, r.y, 1, H - r.y, ledge); P.rect(x1 - 1, r.y, 1, H - r.y, C("#100f18"));
    }
    // obstacles
    for (const o of S.obs) {
      const x = Math.round(o.x - S.dist); if (x < -10 || x > W + 10) continue;
      if (o.kind === "chimney") { P.rect(x, o.y - o.h, o.w, o.h, C("#5a2a2a")); P.rect(x - 1, o.y - o.h, o.w + 2, 2, C("#7a3a32")); for (let yy = o.y - o.h + 3; yy < o.y; yy += 2) P.rect(x + ((yy & 2) ? 0 : 2), yy, 2, 1, C("#4a2222")); P.px(x + 1, o.y - o.h - 2 - (Math.floor(t * 3) % 3), C("#6a6680")); }
      else { P.rect(x, o.y - o.h, o.w, o.h, C("#6a6f7c")); P.rect(x, o.y - o.h, o.w, 1, C("#9aa0ae")); P.ell(x + o.w / 2 - .5, o.y - o.h / 2 - .5, 1.5, 1.5, C("#3a3e48")); P.px(x + o.w / 2 - .5 + Math.round(Math.cos(t * 12)), o.y - o.h / 2 - .5 + Math.round(Math.sin(t * 12)), C("#9aa0ae")); }
    }
    // records to catch
    for (const rc of S.recs2) {
      if (rc.got) continue;
      const x = Math.round(rc.x - S.dist), y = Math.round(rc.y + Math.sin(t * 3 + rc.ph) * 1.5); if (x < -8 || x > W + 8) continue;
      P.ell(x, y, 3.5, 3.5, C("#0e0e12"), C("#2a2a36")); P.px(x, y, tint); P.px(x + 1, y, tint); P.px(x, y + 1, tint); P.px(x + 1, y + 1, tint);
      const a = t * 6 + rc.ph; P.px(x + Math.round(Math.cos(a) * 2.5), y + Math.round(Math.sin(a) * 2.5), C("#8a8aa0"));
    }
    // the cat
    const frames = CAT.run, fr = S.mode === "run" && S.ground ? frames[Math.floor(S.anim) % frames.length] : CAT.jump;
    drawCat(PX, Math.round(S.y), fr, S.mode === "over" && S.dead > .05);
    for (const d of S.dust) P.px(d.x, d.y, C("#8a86a0"));
    // popups
    for (const p of S.pops) { const f = 1 - p.age / .9, w = p.text.length * 4 - 1; if (f > 0) P.text(p.text, Math.round(p.x - w / 2 + 10), Math.round(p.y), bay(Math.round(p.x), Math.round(p.y)) < f * 16 ? p.c : shade(p.c, .6)); }
    out.set(P.b);
    g.putImageData(img, 0, 0);
  }

  // ---------- audio: the record, an analyser, and a few blips ----------
  let ctx, analyser, freq, sfx;
  function ensureGraph() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .5; freq = new Uint8Array(analyser.frequencyBinCount);
      ctx.createMediaElementSource(audio).connect(analyser).connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = .5; sfx.connect(ctx.destination);
    } catch (e) { console.warn("Web Audio unavailable", e); ctx = null; }
  }
  function blip(f, len, type = "triangle") {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + len);
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(.18, t + .005); gn.gain.exponentialRampToValueAtTime(.0001, t + len + .12);
    o.connect(gn).connect(sfx); o.start(t); o.stop(t + len + .15);
  }

  // ---------- records: the site's catalog, by mood ----------
  const MOODS = [{ id: "lofi", label: "Lo-fi" }, { id: "chill", label: "Chill" }, { id: "night", label: "Night" }, { id: "focus", label: "Focus" }];
  let catalog = [], mood = store.get("mv.rooftop.mood") || "lofi", track = null, recent = [], back = [], want = false, fails = 0;
  async function loadCatalog() { try { catalog = (await (await fetch("data/catalog.json")).json()).tracks.filter((t) => t.provider === "audius" && t.url); } catch (e) { console.warn(e); } }
  function pick() {
    const pool = catalog.filter((t) => t.category === mood), all = pool.length ? pool : catalog; if (!all.length) return null;
    const fresh = all.filter((t) => !recent.includes(t.id)), from = fresh.length ? fresh : all, t = from[Math.floor(Math.random() * from.length)];
    recent = [t.id, ...recent].slice(0, 16); return t;
  }
  function setTrack(t) {
    if (!t) return;
    track = t; audio.src = t.url;
    els.title.textContent = t.title; els.artist.textContent = t.artist;
    els.credit.innerHTML = `<a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.title)}</a> by ${esc(t.artist)} · ${esc(t.album)} on Audius`;
    // a new record is a new night: fresh beat tracking, the sky tinted by its cover
    beat.onsets = []; beat.flux = []; beat.phase = 0; beat.lastEst = 0; beat.lastOnset = -1; els.bpm.textContent = "listening…";
    if (t.cover) { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 8; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; tint = RGB(r / n | 0, gg / n | 0, b / n | 0); } catch {} }; im.src = t.cover; }
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "Rooftop cat · Mystery Vinyl", artwork: t.cover ? [{ src: t.cover, sizes: "480x480" }] : [] });
  }
  async function play() { want = true; ensureGraph(); if (!track) setTrack(pick()); try { await audio.play(); } catch (e) { if (e.name !== "AbortError") console.warn(e); } }
  function pause() { want = false; audio.pause(); }
  function nextRecord() { if (track) back = [...back, track].slice(-30); setTrack(pick()); if (want) play(); }
  function prevRecord() { if (audio.currentTime > 3 || !back.length) { audio.currentTime = 0; return; } setTrack(back.pop()); if (want) play(); }
  audio.addEventListener("play", () => document.body.classList.add("playing"));
  audio.addEventListener("pause", () => document.body.classList.remove("playing"));
  audio.addEventListener("ended", nextRecord);
  audio.addEventListener("playing", () => { fails = 0; });
  audio.addEventListener("error", () => { if (++fails > 4) return; setTrack(pick()); if (want) play(); });
  function renderMoods() { els.moods.innerHTML = MOODS.map((m) => `<button class="rt-chip px" data-mood="${m.id}" aria-pressed="${m.id === mood}">${m.label}</button>`).join(""); }
  els.moods.addEventListener("click", (e) => { const b = e.target.closest("[data-mood]"); if (!b || b.dataset.mood === mood) return; mood = b.dataset.mood; store.set("mv.rooftop.mood", mood); renderMoods(); nextRecord(); });
  els.play.addEventListener("click", () => (want ? pause() : play()));
  els.next.addEventListener("click", nextRecord);
  els.prev.addEventListener("click", prevRecord);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", play); navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("nexttrack", nextRecord); navigator.mediaSession.setActionHandler("previoustrack", prevRecord);
  }

  // ---------- flow ----------
  function showCard(title, text, button) { els.cardTitle.textContent = title; els.cardText.textContent = text; els.go.textContent = button; els.card.hidden = false; }
  function start() {
    els.card.hidden = true; play(); reset(); S.mode = "run";
  }
  els.go.addEventListener("click", (e) => { e.stopPropagation(); start(); });
  // input: anywhere on the city is a jump; holding keeps it going
  const isUI = (e) => e.target.closest && e.target.closest("button, a, .rt-hud, .rt-card");
  els.cv.addEventListener("pointerdown", (e) => { if (isUI(e)) return; e.preventDefault(); jump(); });
  addEventListener("pointerup", () => (S.held = false));
  addEventListener("pointercancel", () => (S.held = false));
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); if (!e.repeat) jump(); }
    else if (e.code === "Enter" && S.mode !== "run") start();
    else if (e.code === "KeyN" || e.code === "ArrowRight") nextRecord();
    else if (e.code === "KeyP") want ? pause() : play();
  });
  addEventListener("keyup", (e) => { if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") S.held = false; });

  // the city runs even behind the title card, slowly, so the page is never still
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    let f = null;
    if (ctx && !audio.paused) { analyser.getByteFrequencyData(freq); f = freq; detect(freq, clock()); }
    if (S.mode === "title") { S.dist += 20 * dt; generate(); }
    else if (!(S.mode === "run" && audio.paused && track)) step(dt);       // the run holds still while the record is paused or loading
    draw(f, t);
    requestAnimationFrame(frame);
  }

  fit(); addEventListener("resize", () => { fit(); if (S.mode !== "run") { S.y = BASE; S.roofs = [{ x0: -400, x1: S.dist + W + 400, y: BASE }]; S.genX = S.dist + W + 400; } });
  renderMoods();
  reset(); S.roofs = [{ x0: -400, x1: W + 400, y: BASE }]; S.genX = W + 400; S.y = BASE;
  showCard("Rooftop cat", "Run across the city on the beat of the record. Space, click or tap to jump, hold to jump higher. Catch the records, dodge the chimneys, and jump right on the beat for a PERFECT.", "Start");
  loadCatalog().then(() => { if (!track) setTrack(pick()); });
  requestAnimationFrame(frame);
  // ?debug exposes the run, for testing the level from the console
  if (/[?&]debug\b/.test(location.search)) window.__rt = { S, beat, step, draw, generate, reset, worldX, roofUnder, doJump, get W() { return W; }, get PX() { return PX; }, G, JV };
})();
