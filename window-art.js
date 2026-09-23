/* Window art: the view from a window, in pixels. The sky comes from where the sun and moon really are,
   the weather is whatever it is outside right now, and there is a radio on the sill. */
(() => {
  const W = 200, H = 160;
  const { B8, bay, C, RGB, split, shade, hash, inEll, inRound, NOTES } = window.Pixel;
  const mixC = (a, b, t) => { t = Math.max(0, Math.min(1, t)); const [r1, g1, b1] = split(a), [r2, g2, b2] = split(b); return RGB(r1 + (r2 - r1) * t | 0, g1 + (g2 - g1) * t | 0, b1 + (b2 - b1) * t | 0); };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };

  // the glass, and the horizon inside it
  const GX0 = 40, GX1 = 159, GY0 = 14, GY1 = 109, HOR = 86, MX = 99, MY = 58;
  const inGlass = (x, y) => x >= GX0 && x <= GX1 && y >= GY0 && y <= GY1;

  // sky colours by sun elevation (degrees): zenith, horizon
  const SKY = [
    [-18, "#060a1a", "#0d1330"], [-10, "#0b1230", "#241f4a"], [-5, "#1a1f4c", "#7a4660"], [-1, "#2e3a78", "#e0764a"],
    [4, "#4764a6", "#f2ac72"], [12, "#4c82c6", "#cfe0ea"], [35, "#3b7bd0", "#a6cff0"],
  ].map(([e, a, b]) => [e, C(a), C(b)]);
  function skyAt(el) {
    if (el <= SKY[0][0]) return [SKY[0][1], SKY[0][2]];
    for (let i = 0; i < SKY.length - 1; i++) {
      const [e0, a0, b0] = SKY[i], [e1, a1, b1] = SKY[i + 1];
      if (el <= e1) { const t = (el - e0) / (e1 - e0); return [mixC(a0, a1, t), mixC(b0, b1, t)]; }
    }
    const l = SKY[SKY.length - 1]; return [l[1], l[2]];
  }

  // the city, built once
  const FAR = [], NEAR = [];
  for (let x = GX0 - 4, i = 0; x < GX1 + 4; i++) { const w = 5 + (hash(i, 1) * 8 | 0), h = 5 + (hash(i, 2) * 17 | 0); FAR.push([x, w, h]); x += w + (hash(i, 3) < .3 ? 1 : 0); }
  for (let x = GX0 - 6, i = 0; x < GX1 + 6; i++) { const w = 8 + (hash(i, 11) * 11 | 0), h = 4 + (hash(i, 12) * 14 | 0); NEAR.push([x, w, h, i]); x += w + 1 + (hash(i, 14) * 7 | 0); }
  const STARS = Array.from({ length: 70 }, (_, i) => [GX0 + hash(i, 21) * 120 | 0, GY0 + hash(i, 22) * (HOR - GY0 - 10) | 0, hash(i, 23)]);

  // moving things
  const S = { clouds: [], cloudKey: "", rain: [], snow: [], drops: [], flash: 0, bolt: null, notes: [], noteAcc: 0, t: 0, freqShown: 98.7 };
  for (let i = 0; i < 160; i++) S.rain.push({ x: GX0 + Math.random() * 130, y: GY0 + Math.random() * 96, v: 90 + Math.random() * 50 });
  for (let i = 0; i < 140; i++) S.snow.push({ x: GX0 + Math.random() * 120, y: GY0 + Math.random() * 96, v: 8 + Math.random() * 14, ph: Math.random() * 6 });
  for (let i = 0; i < 22; i++) S.drops.push({ x: GX0 + Math.random() * 120 | 0, y: GY0 + Math.random() * 96, v: 0, wait: Math.random() * 4 });
  function makeClouds(cover, seed) {
    const n = Math.round(cover / 100 * 9);
    S.clouds = Array.from({ length: n }, (_, i) => ({ x: GX0 - 10 + hash(i, seed) * 140, y: GY0 + 6 + hash(i, seed + 1) * 38, s: .6 + hash(i, seed + 2) * .9, k: i }));
  }

  function create(canvas) {
    const g = canvas.getContext("2d");
    // the outside is painted in the scene's own 200x160 frame; the room goes on a buffer of any size, the scene at (ox, oy)
    const O = window.Pixel.painter(W, H);
    let BW, BH, OX, OY, img, out, P;
    function resize(w, h, ox = 0, oy = 0) {
      BW = w; BH = h; OX = ox; OY = oy; canvas.width = w; canvas.height = h;
      img = g.createImageData(w, h); out = new Uint32Array(img.data.buffer);
      P = window.Pixel.painter(w, h); P.ox = ox; P.oy = oy;
    }
    resize(W, H);

    function render(st) {
      const dt = st.dt, t = (S.t += dt), w = st.wx;                    // wx: { cloud, wind, temp, rain, snow, fog, thunder }
      const el = st.sun.el, L = smooth(-8, 8, el);                     // daylight 0..1
      const over = clamp((w.cloud - 40) / 60) * .85 + w.rain * .1 + w.snow * .1;
      const dusk = Math.max(0, 1 - Math.abs(el - 2) / 7);             // the golden-pink hour
      const Li = .22 + .78 * L * (1 - .3 * over);                      // light in the room

      // ---------- outside, into O ----------
      let [top, hor] = skyAt(el);
      const gTop = mixC(C("#161a22"), C("#9aa2ae"), L), gHor = mixC(C("#20242e"), C("#bcc2cc"), L);
      top = mixC(top, gTop, over); hor = mixC(hor, gHor, over * .9);
      const band = [top, mixC(top, hor, .33), mixC(top, hor, .66), hor];
      for (let y = GY0; y <= HOR + 6; y++) {
        const p = clamp((y - GY0) / (HOR - GY0)) * (band.length - 1), i = Math.min(band.length - 2, p | 0), f = p - i;
        for (let x = GX0; x <= GX1; x++) O.b[y * W + x] = B8[(y & 7) * 8 + (x & 7)] < f * 64 ? band[i + 1] : band[i];
      }
      // stars
      const starA = clamp((-6 - el) / 8) * (1 - w.cloud / 100);
      if (starA > 0) for (const [x, y, h] of STARS) if (h < starA && hash(x, Math.floor(t * 1.5 + h * 9)) > .12) O.px(x, y, h < .15 ? C("#ffffff") : C("#9aa6c8"));
      // sun and moon, where they really are (the window faces the equator)
      const place = (az, e) => { const F = st.lat >= 0 ? 180 : 0, rel = ((az - F + 540) % 360) - 180; return [100 + rel / 95 * 64, HOR - e * 1.15]; };
      const veil = clamp((over - .55) / .3);                           // thick cloud hides the sun and moon
      if (el > -4 && veil < 1) {
        const [sx, sy] = place(st.sun.az, el), low = el < 8, core = low ? C("#ffb45e") : C("#fff4cc");
        O.ellD(sx, sy, 10, 10, mixC(hor, core, .35), .45 * (1 - over));
        O.ell(sx, sy, 5, 5, (x, y) => (bay(x, y) >= veil * 16 ? mixC(core, gHor, over * .7) : null));
      }
      const m = st.moon;
      if (m.el > -3 && el < 6 && veil < 1) {
        const [mx, my] = place(m.az, m.el), k = Math.cos(2 * Math.PI * m.phase), lit = C("#f2eed8"), dark = mixC(top, C("#2a2e44"), .5);
        O.ell(mx, my, 4, 4, (x, y) => { const dx = x - mx, dy = y - my, hw = Math.sqrt(Math.max(0, 20.25 - dy * dy)) || 1, u = dx / hw; return bay(x, y) < veil * 16 ? null : (m.phase < .5 ? u > k : -u > k) ? lit : dark; });
        O.px(mx - 1, my - 1, C("#d8d2b8"));
      }
      // clouds
      const key = `${Math.round(w.cloud / 10)}`;
      if (key !== S.cloudKey) { S.cloudKey = key; makeClouds(w.cloud + (w.rain + w.snow) * 30, 31); }
      const cLit = mixC(mixC(mixC(C("#3a4058"), C("#f6f7fa"), L), C("#f4b894"), dusk * .7), gTop, clamp(w.rain * .7 + w.snow * .3 + over * .25)), cSh = mixC(cLit, C("#1a1e2c"), .28);
      for (const c of S.clouds) {
        c.x += (4 + w.wind * .35) * c.s * dt * .12;
        if (c.x > GX1 + 22) c.x = GX0 - 22;
        const puffs = [[0, 0, 9, 4], [-8, 1.5, 6, 3], [8, 1.5, 7, 3], [2, -3, 6, 4], [-3, -2, 5, 3]];
        // lit on top, a solid shadow underneath, one dithered row between
        for (const [dx, dy, rx, ry] of puffs) O.ell(c.x + dx * c.s, c.y + dy * c.s, rx * c.s, ry * c.s, (x, y) => { const k = y - c.y; return k >= 3 ? cSh : k === 2 && bay(x, y) < 8 ? cSh : cLit; });
      }
      // the city: a hazy far row, a nearer row with windows
      const farC = mixC(hor, C("#2a3348"), .4 + (1 - L) * .4), nearC = mixC(hor, C("#161b28"), .68 + (1 - L) * .28);
      const night = L < .35, lit = [C("#f6d27a"), C("#ffe6a6"), C("#bcd6ff")];
      for (const [x, bw, h] of FAR) {
        O.rect(x, HOR - h, bw, GY1 - HOR + h + 1, farC);
        if (night) for (let yy = HOR - h + 2; yy < GY1; yy += 3) for (let xx = x + 1; xx < x + bw - 1; xx += 2) if (hash(xx, yy) > .9) O.px(xx, yy, mixC(farC, lit[0], .6));
      }
      for (const [x, bw, h, i] of NEAR) {
        const y0 = GY1 - h - 12;
        O.rect(x, y0, bw, GY1 - y0 + 1, nearC);
        O.rect(x, y0, 1, GY1 - y0 + 1, shade(nearC, 1.15));
        if (w.snow > .2) O.rect(x, y0, bw, 1, C("#e8ecf4"));
        for (let yy = y0 + 2; yy < GY1 - 1; yy += 3) for (let xx = x + 2; xx < x + bw - 1; xx += 3) {
          const hsh = hash(xx * 7 + i, yy + Math.floor(t / 23 + hash(xx, yy) * 5) * (hash(xx, i) > .95 ? 1 : 0));
          if (night) { if (hsh > .55 - (1 - L) * .1) O.rect(xx, yy, 2, 1, lit[(hsh * 7 | 0) % 3]); }
          else if (hsh > .75) O.rect(xx, yy, 2, 1, shade(nearC, 1.35 + L * .2));
        }
      }
      // rain, snow
      const rainN = Math.round(w.rain * S.rain.length), slant = clamp(w.wind / 40, 0, 1.2);
      const rc = mixC(C("#44547a"), C("#c2d0de"), L);
      for (let i = 0; i < rainN; i++) {
        const d = S.rain[i]; d.y += d.v * dt; d.x += d.v * dt * slant * .35;
        if (d.y > GY1 + 4) { d.y = GY0 - 4 - Math.random() * 10; d.x = GX0 - 10 + Math.random() * 130; }
        for (let k = 0; k < 3; k++) O.px(d.x - k * slant * .35, d.y - k, bay(d.x | 0, (d.y | 0) - k) < 12 ? rc : shade(rc, .8));
      }
      const snowN = Math.round(w.snow * S.snow.length), sc = mixC(C("#8a92a8"), C("#f6f8fc"), L);
      for (let i = 0; i < snowN; i++) {
        const f = S.snow[i]; f.y += f.v * dt; f.x += (Math.sin(t * 1.3 + f.ph) * 6 + w.wind * .3) * dt;
        if (f.y > GY1 + 2) { f.y = GY0 - 2; f.x = GX0 + Math.random() * 120; }
        if (f.x > GX1 + 2) f.x = GX0 - 2;
        O.px(f.x, f.y, sc); if (f.v > 18) O.px(f.x + 1, f.y, sc);
      }
      // fog
      if (w.fog > 0) { const fc = mixC(C("#2a2e38"), C("#c8ccd4"), L); for (let y = GY0; y <= GY1; y++) { const lv = w.fog * (.45 + .4 * (y - GY0) / (GY1 - GY0)); for (let x = GX0; x <= GX1; x++) if (bay(x, y) < lv * 16) O.b[y * W + x] = fc; } }
      // lightning
      if (w.thunder && S.flash <= 0 && Math.random() < dt / 9) { S.flash = .28; let x = GX0 + 20 + Math.random() * 80, y = GY0; S.bolt = [[x, y]]; while (y < HOR) { y += 4 + Math.random() * 6; x += (Math.random() - .5) * 10; S.bolt.push([x, y]); } }
      if (S.flash > 0) {
        S.flash -= dt;
        for (let y = GY0; y <= GY1; y++) for (let x = GX0; x <= GX1; x++) if (bay(x, y) < 6) O.b[y * W + x] = C("#e8ecff");
        if (S.bolt && S.flash > .12) for (let i = 1; i < S.bolt.length; i++) O.line(S.bolt[i - 1][0], S.bolt[i - 1][1], S.bolt[i][0], S.bolt[i][1], C("#ffffff"));
      }

      // ---------- the room, into P ----------
      const wall = mixC(mixC(C("#231c26"), C("#d9c9ad"), Li), C("#4a2e24"), (1 - Li) * .3);
      const { X0, Y0, X1, Y1 } = P.bounds();
      P.rect(X0, Y0, X1 - X0, Y1 - Y0, wall);
      for (let x = 2 + Math.floor((X0 - 2) / 6) * 6; x < X1; x += 6) P.rect(x, Y0, 1, Y1 - Y0, shade(wall, .94));
      // with room to spare below, a skirting board and a floor
      if (Y1 - 160 > 14) { const fl = Y1 - 9; P.rect(X0, fl - 3, X1 - X0, 3, shade(C("#efe6d6"), .35 + .65 * Li)); P.rect(X0, fl, X1 - X0, Y1 - fl, shade(C("#8a5a36"), .35 + .6 * Li)); for (let x = X0 + ((-X0) % 23); x < X1; x += 23) P.rect(x, fl + 1, 1, Y1 - fl, shade(C("#6a4228"), .35 + .6 * Li)); }
      // lamp-warm glow at night, around the radio
      if (Li < .6) { const gc = mixC(wall, C("#b0703a"), .3), lv = (.6 - Li) * .8 * 16; P.ell(132, 100, 40, 24, (x, y) => (y < 115 && bay(x, y) < lv * (1 - Math.hypot((x - 132) / 40, (y - 100) / 24)) * 1.6 ? gc : null)); }
      // copy the outside into the glass
      for (let y = GY0; y <= GY1; y++) for (let x = GX0; x <= GX1; x++) P.px(x, y, O.b[y * W + x]);
      // drops on the glass: they wait, then run
      if (w.rain > 0) {
        const dc = mixC(C("#8a9ab8"), C("#eef4fa"), L), dd = mixC(C("#1a2030"), C("#6a7a90"), L);
        for (let i = 0; i < Math.round(22 * Math.min(1, w.rain * 1.6)); i++) {
          const d = S.drops[i];
          if (d.wait > 0) d.wait -= dt; else { d.v = Math.min(40, d.v + dt * 60); d.y += d.v * dt; if (Math.random() < dt * .8) { d.wait = .5 + Math.random() * 2; d.v = 0; } }
          if (d.y > GY1) { d.y = GY0 + Math.random() * 40; d.x = GX0 + Math.random() * 120 | 0; d.wait = Math.random() * 3; }
          if (inGlass(d.x, d.y)) { P.px(d.x, d.y, dc); P.px(d.x, d.y + 1, dd); if (d.v > 10) { P.px(d.x, d.y - 2, dc); P.px(d.x, d.y - 4, dc); } }
        }
      }
      // snow piling up on the outer sill
      if (w.snow > .15) for (let x = GX0; x <= GX1; x++) { const h = 1 + Math.round(w.snow * 3 + hash(x >> 2, 3) * 2); P.rect(x, GY1 - h + 1, 1, h, C("#eef2f8")); }
      // reflections on the panes
      const refl = mixC(P.get(GX0 + 20, GY0 + 20), C("#ffffff"), .18);
      for (const [x0, y0] of [[GX0 + 6, GY0 + 30], [MX + 8, GY0 + 30], [GX0 + 6, MY + 40], [MX + 8, MY + 40]]) for (let k = 0; k < 18; k++) if (bay(x0 + k, y0 - k) < 7) { P.px(x0 + k, y0 - k, refl); P.px(x0 + k + 3, y0 - k, refl); }
      // frame
      const fr = mixC(C("#3a3440"), C("#ece5d8"), Li), frD = shade(fr, .78), frL = shade(fr, 1.08);
      P.rect(34, 8, 132, 6, fr); P.rect(34, 110, 132, 5, fr); P.rect(34, 8, 6, 107, fr); P.rect(160, 8, 6, 107, fr);
      P.rect(MX, GY0, 2, GY1 - GY0 + 1, fr); P.rect(GX0, MY, GX1 - GX0 + 1, 2, fr);
      P.rect(34, 8, 132, 1, frL); P.rect(34, 8, 1, 107, frL);
      P.rect(GX0, GY0, GX1 - GX0 + 1, 1, frD); P.rect(GX0, GY0, 1, GY1 - GY0 + 1, frD); P.rect(MX + 2, GY0, 1, GY1 - GY0 + 1, frD); P.rect(GX0, MY + 2, GX1 - GX0 + 1, 1, frD);
      // curtains on a rod
      const cur = shade(C("#a8483a"), .3 + .7 * Li), curD = shade(cur, .72), curL = shade(cur, 1.12);
      for (const [x0, x1, flare] of [[14, 40, -1], [159, 185, 1]]) {
        for (let x = x0; x <= x1; x++) {
          const k = Math.sin((x - x0) * .9), c = k > .55 ? curL : k < -.45 ? curD : cur;
          const bottom = 126 + Math.round(flare * (x - (x0 + x1) / 2) * .12);
          for (let y = 5; y <= bottom; y++) P.px(x, y, bay(x, y) < 3 && c === cur ? curD : c);
        }
      }
      const rod = shade(C("#7a5a38"), .4 + .6 * Li);
      P.rect(8, 3, 184, 2, rod); P.ell(8, 4, 2, 2, rod); P.ell(191, 4, 2, 2, rod);
      // sill and the radiator below
      const wood = shade(C("#b07a4a"), .35 + .65 * Li);
      P.rect(26, 115, 148, 5, shade(wood, 1.1)); P.rect(26, 115, 148, 1, shade(wood, 1.25)); P.rect(26, 120, 148, 4, shade(wood, .8)); P.dith(26, 124, 148, 2, shade(wall, .7), .5);
      const rad = shade(C("#e6e2da"), .3 + .7 * Li);
      P.rect(60, 133, 80, 22, rad); P.rect(60, 133, 80, 2, shade(rad, 1.06));
      for (let x = 63; x < 138; x += 4) P.rect(x, 136, 1, 17, shade(rad, .8));
      P.rect(60, 154, 80, 1, shade(rad, .7));

      // ---------- on the sill ----------
      // plant
      P.rect(43, 104, 16, 3, shade(C("#c8704a"), .4 + .6 * Li));
      P.poly([[44, 107], [58, 107], [56, 115], [46, 115]], shade(C("#b8603a"), .4 + .6 * Li));
      const lf = [C("#2f6b4a"), C("#3a7d57"), C("#24593c")].map((c) => shade(c, .45 + .55 * Li));
      P.poly([[50, 104], [40, 90], [38, 82], [47, 92]], lf[0]); P.poly([[52, 104], [60, 86], [66, 80], [61, 94]], lf[1]); P.poly([[51, 104], [49, 84], [54, 72], [55, 90]], lf[2]);
      // mug, steaming if it's cold out or early
      const mug = shade(C("#efe6d2"), .4 + .6 * Li);
      P.rect(66, 107, 9, 8, mug); P.rect(66, 107, 9, 1, shade(C("#3a2418"), .6 + .4 * Li)); P.rect(74, 114, 1, 1, shade(mug, .8));
      P.rect(75, 109, 2, 1, mug); P.rect(76, 110, 1, 3, mug); P.rect(75, 112, 2, 1, mug);
      if (w.temp < 16 || (st.hour >= 5 && st.hour < 10)) for (let k = 0; k < 2; k++) for (let y = 94; y < 105; y++) { const x = 69 + k * 3 + Math.round(Math.sin(y * .6 + t * 2.4 + k * 2)); if (bay(x, y) < 16 * (y - 93) / 12) P.px(x, y, mixC(wall, C("#ffffff"), .45)); }
      // the cat sleeps on the sill at night
      if (st.cat) {
        const fur = shade(C("#6a6a74"), .5 + .5 * Li), furD = shade(fur, .75), breathe = Math.sin(t * 2.2) > 0 ? 0 : 1;
        P.ell(94, 111 + breathe * .3, 10, 4 - breathe * .3, fur); P.rect(84, 114, 20, 1, furD);
        P.ell(85, 110, 4, 3, fur); P.px(82, 106, fur); P.px(83, 107, fur); P.px(87, 106, fur); P.px(87, 107, fur);
        P.rect(83, 110, 2, 1, furD); P.rect(86, 110, 2, 1, furD);
        for (const x of [91, 95, 99]) P.rect(x, 108, 1, 3, furD);
        P.line(104, 113, 106, 110, fur); P.line(106, 110, 105, 107, fur);
      }
      // the radio: the station display tunes toward the city's frequency
      S.freqShown += (st.freq - S.freqShown) * (1 - Math.exp(-dt * 3));
      const red = shade(C("#b8423a"), .45 + .55 * Li), redD = shade(red, .75), cream = shade(C("#efe6d2"), .45 + .55 * Li), dk = shade(C("#2a1a14"), 1);
      P.line(150, 99, 163, 70, shade(C("#c8ccd0"), .5 + .5 * Li)); P.px(163, 70, C("#e8ecf0"));
      P.line(120, 99, 123, 94, redD); P.line(123, 94, 141, 94, redD); P.line(141, 94, 144, 99, redD);
      P.round(114, 98, 38, 17, 2, (x, y) => (y < 100 ? shade(red, 1.12) : y > 112 ? redD : red), shade(red, .55));
      P.rect(117, 101, 15, 11, cream);
      for (let y = 102; y < 111; y += 2) for (let x = 118; x < 131; x += 2) P.px(x, y, st.playing && hash(x, y + Math.floor(t * 8)) < st.level * .5 ? shade(cream, .6) : shade(cream, .72));
      const on = st.playing, amber = on ? C("#ffcf72") : C("#6a4a28");
      const fq = S.freqShown.toFixed(1);
      P.rect(133, 101, 18, 7, dk); P.text(fq, 133 + Math.floor((18 - (fq.length * 4 - 1)) / 2), 102, amber);
      if (on) P.ellD(142, 104, 10, 6, mixC(wall, C("#ffcf72"), .4), .25);
      P.ell(138, 111, 1.5, 1.5, cream); P.ell(146, 111, 1.5, 1.5, cream);
      P.px(116, 99, on ? C("#7cf0a0") : shade(red, .6));

      // notes drift up from the radio
      if (on) { S.noteAcc += dt * (.4 + st.level * 2.6); while (S.noteAcc > 1) { S.noteAcc -= 1; S.notes.push({ x: 124 + (Math.random() - .5) * 14, y: 94, age: 0, life: 2.6 + Math.random() * 1.4, k: Math.random() < .4 ? 1 : 0, ph: Math.random() * 6 }); } }
      for (const n of S.notes) { n.age += dt; n.y -= dt * (8 + st.level * 5); }
      S.notes = S.notes.filter((n) => n.age < n.life).slice(-20);

      out.set(P.b);
      const nc = mixC(C("#f6e7c8"), C("#f2b134"), .4);
      for (const n of S.notes) {
        const fade = Math.min(1, n.age / .3, (n.life - n.age) / .8), x = Math.round(n.x + Math.sin(n.age * 2 + n.ph) * 3), y = Math.round(n.y);
        NOTES[n.k].forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "1" && bay(x + i, y + j) < fade * 16) { const xx = x + i + OX, yy = y + j + OY; if (xx >= 0 && yy >= 0 && xx < BW && yy < BH) out[yy * BW + xx] = nc; } });
      }
      g.putImageData(img, 0, 0);
    }
    return { render, resize, sample(x, y) { return split(out[Math.min(BH - 1, Math.max(0, y)) * BW + Math.min(BW - 1, Math.max(0, x))]); } };
  }

  // ---------- where the sun and moon are (a compact NOAA-style solution, good to a fraction of a degree) ----------
  function sunPos(ms, lat, lon) {
    const rad = Math.PI / 180, d = ms / 86400000 - 10957.5;
    const g = ((357.529 + .98560028 * d) % 360) * rad, q = (280.459 + .98564736 * d) % 360;
    const L = (q + 1.915 * Math.sin(g) + .02 * Math.sin(2 * g)) * rad, e = (23.439 - .00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24, Hh = (gmst * 15 + lon) * rad - ra, la = lat * rad;
    const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(Hh));
    const az = Math.atan2(-Math.sin(Hh), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(Hh));
    return { el: alt / rad, az: ((az / rad) + 360) % 360 };
  }
  // the moon trails the sun by its phase; close enough for a window
  function moonPos(ms, lat, lon) {
    const phase = (((ms / 86400000 - 10957.5 - 5.26) / 29.530588) % 1 + 1) % 1;
    return { ...sunPos(ms - phase * 86400000 * 1.035, lat, lon), phase };
  }

  window.WArt = { W, H, create, sunPos, moonPos };
})();
