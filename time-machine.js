/* Time machine — one record through 126 years of players. Every era is the same audio, reshaped live with Web Audio. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };

  const audio = $("#audio");
  const els = {
    year: $("#year"), name: $("#name"), medium: $("#medium"), blurb: $("#blurb"), band: $("#band"), channels: $("#channels"), noise: $("#noise"),
    spec: $("#spec"), play: $("#play"), prev: $("#prev"), next: $("#next"), title: $("#title"), artist: $("#artist"), credit: $("#credit"),
    room: $("#room"), range: $("#range"), ticks: $("#ticks"), hint: $("#hint"), theme: $("#theme"), toast: $("#toast"),
  };

  // ---------- the eras ----------
  // snd: hp / lp are the band edges in Hz; sat mixes in valve / tape saturation; crackle and pops (per second) are the
  // surface noise, hiss the broadband hiss, stat the radio static; wow / flutter swing a short delay (seconds) at wowHz
  // and ~7 Hz to wobble the pitch; width runs mono (0) to stereo (1); fade is AM fading; gain evens out the loudness.
  const ERAS = [
    { year: 1900, name: "Gramophone", medium: "Shellac disc · 78 rpm", channels: "Mono", noise: "Surface crackle",
      blurb: "No electricity. A steel needle rides the groove and a brass horn makes it loud enough for the whole parlour. Wind it up before every side.",
      snd: { hp: 380, lp: 2800, sat: .8, crackle: 1, pops: 16, hiss: .6, stat: 0, wow: .0007, wowHz: 1.3, flutter: .00004, width: 0, fade: 0, gain: 1.9 } },
    { year: 1935, name: "Tube radio", medium: "AM broadcast · valves", channels: "Mono", noise: "Static",
      blurb: "The music arrives through the air. The valves take a moment to warm up, the dial glows, and there's always a little static between stations.",
      snd: { hp: 200, lp: 4200, sat: .55, crackle: .25, pops: 4, hiss: .15, stat: .8, wow: 0, wowHz: 1, flutter: 0, width: 0, fade: .35, gain: 1.55 } },
    { year: 1958, name: "Record player", medium: "Vinyl LP · 33⅓ rpm", channels: "Stereo, brand new", noise: "Light crackle",
      blurb: "Twenty minutes a side on long-playing vinyl, and stereo is brand new. The whole family gathers around a suitcase that plays music.",
      snd: { hp: 40, lp: 12000, sat: .3, crackle: .45, pops: 6, hiss: .08, stat: 0, wow: .00018, wowHz: .55, flutter: 0, width: .6, fade: 0, gain: 1.12 } },
    { year: 1981, name: "Cassette player", medium: "Compact cassette · C-60", channels: "Stereo", noise: "Tape hiss",
      blurb: "Music leaves the house. A tape in your pocket, orange foam headphones, and a mixtape someone made just for you.",
      snd: { hp: 55, lp: 10000, sat: .4, crackle: 0, pops: 0, hiss: .6, stat: 0, wow: .00035, wowHz: .9, flutter: .00006, width: .9, fade: 0, gain: 1.08 } },
    { year: 1995, name: "CD player", medium: "Compact disc · 16-bit digital", channels: "Stereo", noise: "None at all",
      blurb: "Digital and spotless: no hiss, no crackle, perfect every time. Just don't run with it. Tap it while it plays and see.",
      snd: { hp: 20, lp: 20000, sat: 0, crackle: 0, pops: 0, hiss: 0, stat: 0, wow: 0, wowHz: 1, flutter: 0, width: 1, fade: 0, gain: 1 } },
    { year: 2005, name: "MP3 player", medium: "MP3 · 128 kbps", channels: "Stereo", noise: "None, but the highs are trimmed",
      blurb: "A thousand songs in your pocket. Squeezed to fit, the cymbals lose a little of their shine, and nobody minds.",
      snd: { hp: 20, lp: 15500, sat: 0, crackle: 0, pops: 0, hiss: 0, stat: 0, wow: 0, wowHz: 1, flutter: 0, width: 1, fade: 0, gain: 1 } },
    { year: 2026, name: "Streaming", medium: "Lossless stream", channels: "Stereo, spatial", noise: "None",
      blurb: "Every song ever recorded, on demand, anywhere. The cleanest the music has ever sounded.",
      snd: { hp: 18, lp: 20000, sat: 0, crackle: 0, pops: 0, hiss: 0, stat: 0, wow: 0, wowHz: 1, flutter: 0, width: 1, fade: 0, gain: 1 } },
  ];
  const Y0 = ERAS[0].year, Y1 = ERAS[ERAS.length - 1].year;
  const LOG = { hp: true, lp: true };

  // Where between two eras are we? The sound and the room hold still near each era and change around the midpoint.
  function mix(y) {
    let i = 0; while (i < ERAS.length - 2 && y >= ERAS[i + 1].year) i++;
    const a = ERAS[i], b = ERAS[i + 1];
    const s = smooth(.25, .75, clamp((y - a.year) / (b.year - a.year)));
    const snd = {};
    for (const k in a.snd) snd[k] = LOG[k] ? Math.exp(lerp(Math.log(a.snd[k]), Math.log(b.snd[k]), s)) : lerp(a.snd[k], b.snd[k], s);
    // the picture switches over a narrower window than the sound, so a slow drag never parks on a half-dissolved room
    return { i, s, sv: smooth(.4, .6, clamp((y - a.year) / (b.year - a.year))), era: s < .5 ? i : i + 1, snd };
  }

  const state = { want: false, year: Y0, era: -1, snd: ERAS[0].snd, pool: [], recent: [], back: [], track: null, trackNo: 0, fails: 0, anim: 0, level: 0, warm: 0, dragged: false };

  // ---------- audio graph ----------
  let ctx, A;
  function noiseBuffer(sec) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function loopNoise() { const n = ctx.createBufferSource(); n.buffer = A.noise; n.loop = true; n.start(0, Math.random() * 2); return n; }
  function lfo(freq, depth, target) { const o = ctx.createOscillator(); o.frequency.value = freq; const g = ctx.createGain(); g.gain.value = depth; o.connect(g).connect(target); o.start(); return { o, g }; }
  function ensureGraph() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      A = {};
      A.noise = noiseBuffer(3);
      const src = ctx.createMediaElementSource(audio);
      // wow & flutter: a short delay whose length swings, which bends the pitch
      A.wow = ctx.createDelay(0.05); A.wow.delayTime.value = 0.012;
      A.wowLfo = lfo(1.3, 0, A.wow.delayTime);
      A.flLfo = lfo(7.3, 0, A.wow.delayTime);
      A.bandIn = ctx.createGain();
      src.connect(A.wow).connect(A.bandIn);
      // the band: two stacked high-passes and two low-passes (24 dB/oct each side)
      const biq = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = .707; return b; };
      A.hp = [biq("highpass", 20), biq("highpass", 20)];
      A.lp = [biq("lowpass", 20000), biq("lowpass", 20000)];
      A.bandIn.connect(A.hp[0]).connect(A.hp[1]).connect(A.lp[0]).connect(A.lp[1]);
      // saturation: a clean path and a tanh path, crossfaded
      A.clean = ctx.createGain(); A.wet = ctx.createGain(); A.wet.gain.value = 0;
      A.shaper = ctx.createWaveShaper();
      const curve = new Float32Array(2048), K = 2.6;
      for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(K * x) / K * 1.25; }
      A.shaper.curve = curve; A.shaper.oversample = "2x";
      A.sum = ctx.createGain();
      A.lp[1].connect(A.clean).connect(A.sum);
      A.lp[1].connect(A.shaper).connect(A.wet).connect(A.sum);
      // AM fading: a slow swell in the level
      A.fade = ctx.createGain();
      A.fadeLfo = [lfo(.23, 0, A.fade.gain), lfo(.09, 0, A.fade.gain)];
      A.makeup = ctx.createGain();
      A.sum.connect(A.fade).connect(A.makeup);
      // width: a mono fold-down crossfaded against the untouched stereo
      A.mono = ctx.createGain(); A.mono.channelCount = 1; A.mono.channelCountMode = "explicit"; A.mono.channelInterpretation = "speakers";
      A.monoAmt = ctx.createGain(); A.stereoAmt = ctx.createGain();
      A.master = ctx.createGain();
      A.makeup.connect(A.mono).connect(A.monoAmt).connect(A.master);
      A.makeup.connect(A.stereoAmt).connect(A.master);
      A.analyser = ctx.createAnalyser(); A.analyser.fftSize = 4096; A.analyser.smoothingTimeConstant = .8;
      A.master.connect(A.analyser).connect(ctx.destination);
      A.freq = new Uint8Array(A.analyser.frequencyBinCount); A.time = new Uint8Array(A.analyser.fftSize);
      // noise goes into the band too, so a gramophone's hiss is as narrow as its music; the gate shuts it with the music
      A.gate = ctx.createGain(); A.gate.gain.value = 0; A.gate.connect(A.bandIn);
      A.hiss = ctx.createGain(); A.hiss.gain.value = 0;
      const hissHp = biq("highpass", 900); loopNoise().connect(hissHp).connect(A.hiss).connect(A.gate);
      A.stat = ctx.createGain(); A.stat.gain.value = 0;
      const statBp = biq("bandpass", 1400); statBp.Q.value = .6;
      const statFade = ctx.createGain(); statFade.gain.value = .6; lfo(.31, .4, statFade.gain); lfo(1.7, .15, statFade.gain);
      loopNoise().connect(statBp).connect(statFade).connect(A.stat).connect(A.gate);
      // the heterodyne whistle between stations
      A.whistle = ctx.createGain(); A.whistle.gain.value = 0;
      const wo = ctx.createOscillator(); wo.frequency.value = 3600; lfo(.07, 260, wo.frequency); wo.connect(A.whistle).connect(A.gate); wo.start();
      // pops: short decaying bursts, scheduled on the audio clock
      A.popBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .012), ctx.sampleRate);
      const pd = A.popBuf.getChannelData(0); for (let i = 0; i < pd.length; i++) pd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / pd.length, 3);
      A.popHp = biq("highpass", 1600); A.popHp.connect(A.gate);
      A.nextPop = ctx.currentTime; schedulePops();
      applySound(true);
    } catch (e) { console.warn("Web Audio unavailable", e); ctx = null; }
  }
  function schedulePops() {
    clearTimeout(A.popTimer);
    const horizon = ctx.currentTime + 1, { pops, crackle } = state.snd;
    if (pops < .3 || crackle < .02) A.nextPop = horizon;
    while (A.nextPop < horizon) {
      const big = Math.random() < .07;
      const src = ctx.createBufferSource(); src.buffer = A.popBuf; src.playbackRate.value = .6 + Math.random() * .8;
      const g = ctx.createGain(); g.gain.value = crackle * .5 * (big ? .6 + Math.random() * .4 : .05 + Math.random() * .2);
      src.connect(g).connect(A.popHp); src.start(Math.max(A.nextPop, ctx.currentTime));
      A.nextPop += -Math.log(1 - Math.random()) / pops;
    }
    A.popTimer = setTimeout(schedulePops, 600);
  }
  function applySound(now) {
    if (!ctx) return;
    const s = state.snd, t = ctx.currentTime, tc = now ? 0.001 : 0.04;
    const to = (p, v) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, tc); };
    for (const f of A.hp) to(f.frequency, s.hp);
    for (const f of A.lp) to(f.frequency, Math.min(s.lp, ctx.sampleRate / 2 - 100));
    to(A.clean.gain, 1 - s.sat); to(A.wet.gain, s.sat);
    to(A.wowLfo.o.frequency, s.wowHz); to(A.wowLfo.g.gain, s.wow); to(A.flLfo.g.gain, s.flutter);
    to(A.fade.gain, 1 - s.fade * .5); for (const l of A.fadeLfo) to(l.g.gain, s.fade * .25);
    to(A.makeup.gain, s.gain);
    to(A.monoAmt.gain, 1 - s.width); to(A.stereoAmt.gain, s.width);
    to(A.hiss.gain, s.hiss * .05); to(A.stat.gain, s.stat * .09); to(A.whistle.gain, s.stat * .0035);
  }
  // the rush of air when time jumps
  let lastWhoosh = 0;
  function whoosh() {
    if (!ctx || audio.paused || performance.now() - lastWhoosh < 160) return;
    lastWhoosh = performance.now();
    const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = A.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4200, t + .38);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .08); g.gain.exponentialRampToValueAtTime(.0001, t + .42);
    n.connect(bp).connect(g).connect(ctx.destination); n.start(t, Math.random()); n.stop(t + .45);
  }

  // ---------- year, era, room ----------
  const art = TMArt.create($("#scene"));
  function setYear(y) {
    y = clamp(y, Y0, Y1); state.year = y;
    els.range.value = y; els.range.style.setProperty("--p", `${(y - Y0) / (Y1 - Y0) * 100}%`);
    els.year.textContent = Math.round(y);
    const m = mix(y);
    state.mix = m;
    state.snd = m.snd; applySound();
    els.band.textContent = `${hz(m.snd.hp)} – ${hz(m.snd.lp)}`;
    if (m.era !== state.era) setEra(m.era);
  }
  const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f / 10) * 10} Hz`);
  function setEra(i) {
    const first = state.era < 0;
    state.era = i;
    const e = ERAS[i];
    els.name.textContent = e.name; els.medium.textContent = e.medium; els.blurb.textContent = e.blurb;
    els.channels.textContent = e.channels; els.noise.textContent = e.noise;
    $$(".tm-tick").forEach((t, j) => t.classList.toggle("on", j === i));
    if (i === 1) state.warm = 0;                 // valves start cold
    if (!first) whoosh();
  }
  // glide to a year; the sound sweeps along the way
  function glideTo(target) {
    cancelAnimationFrame(state.anim);
    const from = state.year, d = target - from;
    if (Math.abs(d) < .05) { setYear(target); settle(); return; }
    const ms = clamp(300 + Math.abs(d) * 9, 300, 1400), t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / ms), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setYear(from + d * e);
      if (t < 1) state.anim = requestAnimationFrame(step); else settle();
    };
    state.anim = requestAnimationFrame(step);
  }
  function settle() { try { history.replaceState(null, "", `#${ERAS[state.era].year}`); } catch {} }
  const nearest = (y) => ERAS.reduce((b, e) => (Math.abs(e.year - y) < Math.abs(b.year - y) ? e : b)).year;

  // ---------- timeline ----------
  els.ticks.innerHTML = ERAS.map((e, i) => `<button class="tm-tick" data-i="${i}" style="left:${(e.year - Y0) / (Y1 - Y0) * 100}%"><span>${e.year}</span><b>${esc(e.name)}</b></button>`).join("");
  els.ticks.addEventListener("click", (ev) => { const b = ev.target.closest(".tm-tick"); if (b) { dragged(); glideTo(ERAS[+b.dataset.i].year); } });
  els.range.addEventListener("input", () => { cancelAnimationFrame(state.anim); dragged(); setYear(parseFloat(els.range.value)); });
  els.range.addEventListener("change", () => glideTo(nearest(parseFloat(els.range.value))));
  function dragged() { if (state.dragged || audio.paused) return; state.dragged = true; els.hint.classList.add("done"); }

  // ---------- records ----------
  async function loadCatalog() {
    try {
      const j = await (await fetch("data/catalog.json")).json();
      const ok = j.tracks.filter((t) => t.provider === "audius" && t.url);
      // jazz and piano sound best through a horn; lo-fi fills the rest
      state.pool = ok.filter((t) => t.category === "focus").concat(ok.filter((t) => t.category !== "focus" && Math.random() < .35));
      if (!state.pool.length) state.pool = ok;
    } catch (e) { console.warn(e); }
    if (!state.pool.length) { els.title.textContent = "No records in the crate"; return; }
    setTrack(pick());
  }
  function pick() {
    const fresh = state.pool.filter((t) => !state.recent.includes(t.id));
    const t = (fresh.length ? fresh : state.pool)[Math.floor(Math.random() * (fresh.length || state.pool.length))];
    state.recent = [t.id, ...state.recent].slice(0, 12);
    return t;
  }
  function setTrack(t) {
    state.track = t; state.trackNo = (state.trackNo % 99) + 1;
    audio.src = t.url;
    art.loadCover(t.cover, t.id.length + t.title.length);
    els.title.textContent = t.title; els.artist.textContent = t.artist;
    els.credit.innerHTML = `<a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.title)}</a> by ${esc(t.artist)} · ${esc(t.album)} on Audius`;
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "Time Machine · Mystery Vinyl", artwork: t.cover ? [{ src: t.cover, sizes: "480x480" }] : [] });
  }
  function gate(open) { if (ctx) A.gate.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? .15 : .05); }
  async function play() {
    state.want = true;
    ensureGraph();
    document.body.classList.remove("armed");
    try { await audio.play(); } catch (e) { if (e.name !== "AbortError") console.warn(e); }
    if (!state.dragged) els.hint.textContent = "Now drag the timeline, or tap a year";
  }
  function pause() { state.want = false; audio.pause(); }
  function toggle() { state.want ? pause() : play(); }
  // next pulls a fresh record and remembers the one we leave; previous restarts the record, or goes back if we just started it
  function nextRecord() { if (state.track) state.back = [...state.back, state.track].slice(-30); setTrack(pick()); if (state.want) play(); }
  function prevRecord() {
    if (audio.currentTime > 3 || !state.back.length) { audio.currentTime = 0; return; }
    setTrack(state.back.pop()); if (state.want) play();
  }
  audio.addEventListener("play", () => document.body.classList.add("playing"));
  audio.addEventListener("pause", () => { document.body.classList.remove("playing"); gate(false); });
  audio.addEventListener("playing", () => { state.fails = 0; gate(true); });
  audio.addEventListener("waiting", () => gate(false));
  audio.addEventListener("ended", () => { nextRecord(); play(); });
  audio.addEventListener("error", () => { if (!state.track || ++state.fails > 4) return; setTrack(pick()); if (state.want) play(); });
  els.play.addEventListener("click", toggle);
  els.next.addEventListener("click", nextRecord);
  els.prev.addEventListener("click", prevRecord);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("nexttrack", nextRecord);
    navigator.mediaSession.setActionHandler("previoustrack", prevRecord);
  }

  // tap the player to start it; tap the CD player while it plays and it skips
  els.room.addEventListener("click", () => {
    if (!state.want) { play(); return; }
    if (state.era !== 4 || audio.paused) return;
    const t0 = audio.currentTime;
    let n = 0;
    const hic = () => { if (++n > 5) return; audio.currentTime = t0; setTimeout(hic, 95); };
    hic(); art.skip();
    toast("Skip! That's what anti-skip memory was for");
  });


  // ---------- the animation loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const playing = !audio.paused;
    let lvl = 0, freq = null;
    if (ctx && playing) {
      A.analyser.getByteTimeDomainData(A.time); let sum = 0; for (let i = 0; i < A.time.length; i += 8) { const v = (A.time[i] - 128) / 128; sum += v * v; } lvl = Math.sqrt(sum / (A.time.length / 8));
      A.analyser.getByteFrequencyData(A.freq); freq = A.freq;
    }
    state.level += (clamp(lvl * 3) - state.level) * (lvl * 3 > state.level ? .5 : .12);
    if (state.era === 1) state.warm = clamp(state.warm + dt / 1.6);
    const m = state.mix, t = state.track || {};
    art.render({
      i: m.i, s: m.sv, era: state.era, dt, playing, level: state.level, freq, warm: state.warm,
      p: audio.duration ? clamp(audio.currentTime / audio.duration) : 0, cur: audio.currentTime || 0, trackNo: state.trackNo,
      title: t.title || "", artist: t.artist || "",
    });
    drawSpec(playing);
    imm.tick();
    requestAnimationFrame(frame);
  }

  // ---------- "what you hear": the era's band as a ghost, the music live inside it ----------
  const sc = els.spec.getContext("2d");
  let colors;
  function readColors() { const cs = getComputedStyle(els.spec); colors = { on: cs.getPropertyValue("--accent").trim(), ghost: cs.getPropertyValue("--line").trim(), faint: cs.getPropertyValue("--faint").trim() }; }
  const SPEC_BARS = 56, F0 = 20, F1 = 20000;
  const specLive = new Float32Array(SPEC_BARS);
  // magnitude of two stacked 2nd-order Butterworth sections per side
  const resp = (f, hp, lp) => { const h = Math.pow(f / hp, 2), l = Math.pow(lp / f, 2); return Math.pow(h / Math.sqrt(1 + h * h), 2) * Math.pow(l / Math.sqrt(1 + l * l), 2); };
  function drawSpec(playing) {
    const W = els.spec.width, H = els.spec.height, gap = 5, bw = (W - gap * (SPEC_BARS - 1)) / SPEC_BARS;
    const SEG = 5, STEP = 9, maxSegs = Math.floor((H + (STEP - SEG)) / STEP);
    sc.clearRect(0, 0, W, H);
    const { hp, lp } = state.snd, bins = ctx ? A.analyser.frequencyBinCount : 0, nyq = ctx ? ctx.sampleRate / 2 : 24000;
    for (let i = 0; i < SPEC_BARS; i++) {
      const fa = F0 * Math.pow(F1 / F0, i / SPEC_BARS), fb = F0 * Math.pow(F1 / F0, (i + 1) / SPEC_BARS), fc = Math.sqrt(fa * fb);
      const g = Math.pow(resp(fc, hp, lp), .5);
      let v = 0;
      if (ctx && playing) {
        const ba = Math.floor(fa / nyq * bins), bb = Math.max(ba + 1, Math.ceil(fb / nyq * bins));
        let m = 0; for (let b = ba; b < bb && b < bins; b++) m = Math.max(m, A.freq[b]);
        v = Math.pow(m / 255, 1.6) * 1.15;
      }
      specLive[i] += (v - specLive[i]) * (v > specLive[i] ? .6 : .15);
      const x = i * (bw + gap);
      const ghost = Math.max(1, Math.round(g * maxSegs * .92)), live = Math.min(ghost, Math.round(clamp(specLive[i]) * maxSegs));
      for (let s = 0; s < ghost; s++) {
        sc.fillStyle = s < live ? colors.on : colors.ghost;
        sc.fillRect(x, H - s * STEP - SEG, bw, SEG);
      }
    }
  }

  // ---------- theme, keys, toast ----------
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.hidden = false; els.toast.classList.remove("leaving");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.classList.add("leaving"); setTimeout(() => (els.toast.hidden = true), 300); }, 2200);
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input[type=text], input[type=url], textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
      e.preventDefault(); dragged();
      glideTo(ERAS[clamp(state.era + (e.code === "ArrowRight" ? 1 : -1), 0, ERAS.length - 1)].year);
    }
  });

  // ---------- go ----------
  const imm = Immersive($("#scene"), art, { anchor: "floor", onInk: readColors });
  readColors();
  const fromHash = parseInt(location.hash.slice(1), 10);
  setYear(ERAS.some((e) => e.year === fromHash) ? fromHash : Y0);
  document.body.classList.add("armed");
  loadCatalog();
  requestAnimationFrame(frame);
})();
