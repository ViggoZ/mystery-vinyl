/* Mystery Vinyl — random records for coding, focus, thinking and designing. */
(() => {
  const $ = (s) => document.querySelector(s);
  const audio = $("#audio");
  const els = {
    modes: $("#modes"), wave: $("#wave"), cur: $("#cur"), dur: $("#dur"),
    title: $("#title"), artist: $("#artist"), credit: $("#credit"),
    play: $("#play"), prev: $("#prev"), next: $("#next"), power: $("#power"),
    theme: $("#theme"), zen: $("#zen"), crackle: $("#crackle"), toast: $("#toast"),
    arm: $("#arm"), armWobble: $("#armWobble"), record: $("#record"), label: $("#label"), platter: $("#platter"),
    hint: $("#hint"),
    crate: $("#crate"), crateForm: $("#crate-form"), crateInput: $("#crate-input"), crateList: $("#crate-list"), ytShell: $("#yt-shell"),
  };

  // ---------- turntable geometry (design space 840x680) ----------
  const PIVOT = { x: 700, y: 150 };        // tonearm bearing
  const CENTER = { x: 340, y: 350 };       // platter centre
  const ARM_LEN = 420;                     // pivot -> stylus (headshell sits at y=560, stylus ~+70 rotated)
  const R_LEAD_IN = 282;                   // record radius where the needle drops
  const R_LEAD_OUT = 112;                  // run-out groove (label edge ~107)
  const RPM = 100 / 3;                     // 33⅓
  const OMEGA_PLAY = RPM * 360 / 60;       // deg/s

  // Angle (CSS rotate, deg) that puts the stylus on groove radius r.
  function armAngleFor(r) {
    const dx = CENTER.x - PIVOT.x, dy = CENTER.y - PIVOT.y;
    const D = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);                       // pivot -> centre
    const cosPhi = (ARM_LEN ** 2 + D ** 2 - r ** 2) / (2 * ARM_LEN * D);
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
    const rest = Math.PI / 2;                              // arm hangs straight down at rest
    return ((base - phi) - rest) * 180 / Math.PI;
  }
  const ANGLE_REST = 0;
  const ANGLE_IN = armAngleFor(R_LEAD_IN);
  const ANGLE_OUT = armAngleFor(R_LEAD_OUT);

  // ---------- state ----------
  const state = {
    catalog: null, category: null, queue: [], index: -1, cur: null,
    playing: false, targetOmega: 0, brake: false, busy: false, armed: false, everPlayed: false,
    omega: 0, angle: 0,              // platter (motor-driven)
    recOmega: 0, recAngle: 0,        // record: sits on the mat, slips a little against it
    history: [],
    sources: [], yoursTracks: [],    // user-added crate ("Yours")
  };

  // ---------- helpers ----------
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isYT = (t) => !!t && t.kind === "yt";

  // Where are we in the current record? Works for both backends.
  function pos() {
    if (isYT(state.cur)) {
      const p = yt.player;
      if (!p || !p.getCurrentTime) return { t: 0, d: 0, live: false };
      const d = p.getDuration() || 0, t = p.getCurrentTime() || 0;
      // A live stream reports either no duration or a huge, ever-growing one with the
      // playhead pinned to its end. Show time-since-you-tuned-in instead.
      if (yt.lastDur > 0 && d > yt.lastDur + 1) yt.isLive = true;     // duration keeps growing: live
      yt.lastDur = d;
      const live = yt.isLive || d > 12 * 3600 || (d === 0 && p.getPlayerState && p.getPlayerState() === 1);
      if (live) { if (!yt.liveStart) yt.liveStart = Date.now(); return { t: (Date.now() - yt.liveStart) / 1000, d: 0, live: true }; }
      return { t, d, live: false };
    }
    const d = isFinite(audio.duration) ? audio.duration : 0;
    return { t: audio.currentTime || 0, d, live: !isFinite(audio.duration) && !audio.paused };
  }

  // ---------- platter physics (spin-up / spin-down) ----------
  // Two bodies, like the real thing: the motor drives the platter, and the
  // record follows the platter through the mat with its own inertia, so it
  // lags on start-up and overruns a touch when the platter stops.
  let last = performance.now();
  function spin(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const s = state;
    const kMotor = s.targetOmega > s.omega ? 1.6 : (s.brake ? 4.5 : 0.7);   // pull-up / brake / coast
    s.omega += (s.targetOmega - s.omega) * (1 - Math.exp(-kMotor * dt));
    if (Math.abs(s.targetOmega - s.omega) < 0.05) s.omega = s.targetOmega;
    const kSlip = 3.2;
    s.recOmega += (s.omega - s.recOmega) * (1 - Math.exp(-kSlip * dt));
    if (Math.abs(s.omega - s.recOmega) < 0.05) s.recOmega = s.omega;
    s.angle = (s.angle + s.omega * dt) % 360;
    s.recAngle = (s.recAngle + s.recOmega * dt) % 360;
    els.platter.style.transform = `rotate(${s.angle}deg)`;
    els.record.style.transform = `rotate(${s.recAngle}deg)`;
    // Tonearm wobble: a slightly warped record nudges the arm once per revolution.
    const onRecord = s.playing && !els.arm.classList.contains("lifted");
    const rad = s.recAngle * Math.PI / 180;
    const wobble = onRecord ? 0.22 * Math.sin(rad) + 0.07 * Math.sin(2 * rad + 1.3) : 0;
    els.armWobble.style.transform = `rotate(${wobble.toFixed(3)}deg)`;
    drawWave(now);
    requestAnimationFrame(spin);
  }
  requestAnimationFrame(spin);

  // ---------- tonearm ----------
  function setArm(deg, { lifted = false, ms = 1100 } = {}) {
    const wasLifted = els.arm.classList.contains("lifted");
    els.arm.style.transitionDuration = `${ms}ms, 400ms`;
    els.arm.classList.toggle("lifted", lifted);
    els.arm.style.transform = `rotate(${deg}deg)`;
    if (lifted !== wasLifted) {
      if (lifted) { needleLift(); setCrackle(false); }
      else setTimeout(() => { needleDrop(); setCrackle(true); }, 220);   // after the drop animation
    }
  }
  function grooveAngle() {
    const { t, d, live } = pos();
    if (live) return ANGLE_IN + (ANGLE_OUT - ANGLE_IN) * 0.12;   // a live stream just sits near the lead-in
    const p = d ? Math.min(1, t / d) : 0;
    return ANGLE_IN + (ANGLE_OUT - ANGLE_IN) * p;
  }
  function trackArm() {
    if (!state.playing) return;
    setArm(grooveAngle(), { lifted: false, ms: 900 });
  }

  // ---------- audio graph / waveform ----------
  let ctx, analyser, data;
  function ensureAudioGraph() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser); analyser.connect(ctx.destination);
      data = new Uint8Array(analyser.frequencyBinCount);
      buildCrackle();
      setCrackle(!els.arm.classList.contains("lifted"));
    } catch (e) { console.warn("Web Audio unavailable", e); }
  }

  // ---------- vinyl surface noise (synthesized, no samples) ----------
  // A looped pink-ish hiss through a band-pass, plus randomly spaced pops
  // (short decaying noise bursts, a few of them big). Everything is scheduled
  // on the audio clock, so it keeps ticking in a background tab.
  const CRACKLE_LEVEL = 0.16;
  const crackle = { on: store.get("mv.crackle") !== "off", gain: null, hp: null, popBuf: null, nextPop: 0, timer: null };
  function buildCrackle() {
    if (!ctx || crackle.gain) return;
    crackle.gain = ctx.createGain(); crackle.gain.gain.value = 0; crackle.gain.connect(ctx.destination);
    // hiss
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.06;
    }
    const hiss = ctx.createBufferSource(); hiss.buffer = buf; hiss.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4200; bp.Q.value = 0.45;
    const hissGain = ctx.createGain(); hissGain.gain.value = 0.4;
    hiss.connect(bp).connect(hissGain).connect(crackle.gain); hiss.start();
    // pops
    const pl = Math.floor(ctx.sampleRate * 0.04), pb = ctx.createBuffer(1, pl, ctx.sampleRate), pd = pb.getChannelData(0);
    for (let i = 0; i < pl; i++) pd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (pl * 0.07));
    crackle.popBuf = pb;
    crackle.hp = ctx.createBiquadFilter(); crackle.hp.type = "highpass"; crackle.hp.frequency.value = 1600;
    crackle.hp.connect(crackle.gain);
    crackle.nextPop = ctx.currentTime;
    schedulePops();
  }
  function pop(level, when = ctx.currentTime) {
    const src = ctx.createBufferSource(); src.buffer = crackle.popBuf;
    src.playbackRate.value = 0.6 + Math.random() * 1.4;
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(g).connect(crackle.hp); src.start(when);
  }
  function schedulePops() {
    clearTimeout(crackle.timer);
    const horizon = ctx.currentTime + 1.6;
    while (crackle.nextPop < horizon) {
      const big = Math.random() < 0.07;
      pop(big ? 0.5 + Math.random() * 0.5 : 0.04 + Math.random() * 0.16, crackle.nextPop);
      crackle.nextPop += -Math.log(1 - Math.random()) / 8;   // ~8 pops/s, exponential spacing
    }
    crackle.timer = setTimeout(schedulePops, 700);
  }
  // Fade the surface noise in when the needle sits in the groove, out when it lifts.
  function setCrackle(onRecord) {
    if (!crackle.gain) return;
    const g = crackle.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(onRecord && crackle.on ? CRACKLE_LEVEL : 0, t, 0.12);
  }
  function needleDrop() {
    if (!ctx || !crackle.on) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    const p = ctx.createBufferSource(); p.buffer = crackle.popBuf; p.playbackRate.value = 0.5;
    const pg = ctx.createGain(); pg.gain.value = 0.25; p.connect(pg).connect(ctx.destination); p.start(t);
  }
  function needleLift() {
    if (!ctx || !crackle.on || !crackle.popBuf) return;
    const p = ctx.createBufferSource(); p.buffer = crackle.popBuf; p.playbackRate.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0.08; p.connect(g).connect(ctx.destination); p.start();
  }
  function toggleCrackle() {
    crackle.on = !crackle.on;
    store.set("mv.crackle", crackle.on ? "on" : "off");
    els.crackle.setAttribute("aria-pressed", String(crackle.on));
    els.crackle.dataset.tip = crackle.on ? "Vinyl crackle on · N" : "Vinyl crackle off · N";
    setCrackle(!els.arm.classList.contains("lifted"));
    toast(crackle.on ? "Vinyl crackle on" : "Vinyl crackle off");
  }

  const wctx = els.wave.getContext("2d");
  let waveOn = "#d9b896", waveOff = "#4a4a4a";
  function refreshWaveColors() {
    const cs = getComputedStyle(document.documentElement);
    waveOn = cs.getPropertyValue("--accent").trim() || waveOn;
    waveOff = cs.getPropertyValue("--wave-off").trim() || waveOff;
  }
  refreshWaveColors();
  const BARS = 48;
  const idle = Array.from({ length: BARS }, (_, i) => 0.08 + 0.05 * Math.abs(Math.sin(i * 1.7)));
  function drawWave(now) {
    const W = els.wave.width, H = els.wave.height, gap = 8, bw = (W - gap * (BARS - 1)) / BARS;
    wctx.clearRect(0, 0, W, H);
    let levels = idle;
    if (state.playing && isYT(state.cur)) {
      // No audio data from the YouTube player: a slow breathing pattern instead.
      const t = now / 1000;
      levels = idle.map((v, i) => 0.1 + 0.32 * Math.abs(Math.sin(t * 1.1 + i * 0.37)) * (0.6 + 0.4 * Math.sin(t * 0.7 + i * 0.11)));
    } else if (analyser && state.playing) {
      analyser.getByteFrequencyData(data);
      levels = [];
      const USABLE = 80;                      // bins above ~14 kHz are empty for most records
      for (let i = 0; i < BARS; i++) {
        // gently curved mapping: more bars for bass/mids, a few for the top end
        const a = Math.floor(Math.pow(i / BARS, 1.5) * USABLE), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BARS, 1.5) * USABLE));
        let m = 0; for (let j = a; j < b; j++) m = Math.max(m, data[j]);
        const gain = 1 + (i / BARS) * 1.4;    // treble is quieter in the spectrum; lift it a bit
        levels.push(0.06 + Math.min(1, (m / 255) * gain) * 0.94);
      }
    }
    const { t, d, live } = pos();
    const progress = live ? 1 : (d ? t / d : 0);
    for (let i = 0; i < BARS; i++) {
      const h = Math.max(4, levels[i] * H);
      wctx.fillStyle = i / BARS < progress ? waveOn : waveOff;
      wctx.fillRect(i * (bw + gap), H - h, bw, h);
    }
  }
  els.wave.addEventListener("click", (e) => {
    const { d, live } = pos();
    if (!d || live) return;
    const r = els.wave.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * d);
    trackArm();
  });
  function seek(sec) {
    if (isYT(state.cur)) { yt.player && yt.player.seekTo(sec, true); }
    else audio.currentTime = sec;
  }
  function updateClock() {
    const { t, d, live } = pos();
    els.cur.textContent = fmt(t);
    els.dur.textContent = live ? "LIVE" : fmt(d);
  }

  // ---------- YouTube backend (hidden IFrame player) ----------
  const yt = { player: null, ready: null, ticker: null, endTimer: null, waiter: null, failures: 0 };
  // Resolve when the player actually starts, reject on a player error or timeout.
  function ytAwaitPlaying(ms = 9000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { yt.waiter = null; reject(new Error("timeout")); }, ms);
      yt.waiter = { resolve: () => { clearTimeout(timer); yt.waiter = null; resolve(); }, reject: (e) => { clearTimeout(timer); yt.waiter = null; reject(e); } };
    });
  }
  function loadYT() {
    if (yt.ready) return yt.ready;
    yt.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("YouTube API timeout")), 15000);
      window.onYouTubeIframeAPIReady = () => {
        const host = document.createElement("div"); els.ytShell.appendChild(host);
        yt.player = new YT.Player(host, {
          width: 200, height: 200,
          playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, origin: location.origin },
          events: {
            onReady: () => { clearTimeout(timeout); resolve(yt.player); },
            onStateChange: onYTState,
            onError: onYTError,
          },
        });
      };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => { clearTimeout(timeout); reject(new Error("YouTube API blocked")); };
      document.head.appendChild(s);
    });
    return yt.ready;
  }
  function onYTState(e) {
    if (!isYT(state.cur)) return;
    const S = YT.PlayerState;
    clearTimeout(yt.endTimer);
    if (e.data === S.PLAYING) {
      state.targetOmega = OMEGA_PLAY;
      state.playing = true; state.everPlayed = true; document.body.classList.add("playing");
      yt.failures = 0;
      if (yt.waiter) yt.waiter.resolve();
      disarm(); ytMeta(); updateClock(); trackArm();
    } else if (e.data === S.PAUSED) {
      if (state.playing && !state.busy) setTimeout(() => {
        if (state.playing && !state.busy && yt.player.getPlayerState() === S.PAUSED) yt.player.playVideo();
      }, 600);
    } else if (e.data === S.BUFFERING) {
      state.targetOmega = state.playing ? OMEGA_PLAY * 0.97 : state.targetOmega;
    } else if (e.data === S.CUED && state.cur.listId) {
      yt.player.setShuffle(true);
    } else if (e.data === S.ENDED) {
      // With a playlist the player usually advances by itself; give it a moment before we step in.
      yt.endTimer = setTimeout(() => {
        const st = yt.player.getPlayerState();
        if (st === S.PLAYING || st === S.BUFFERING) return;
        if (state.cur.listId && ytHasMore(1)) ytStep(1); else next();
      }, 900);
    }
  }
  function onYTError(e) {
    console.warn("YouTube error", e.data);
    const msg = e.data === 150 || e.data === 101 ? "That video doesn't allow playback here" : e.data === 100 ? "That video is unavailable" : "Couldn't play that";
    if (yt.waiter) yt.waiter.reject(new Error(msg));
    else if (!state.busy) { toast(`${msg} · skipping`); next(); }
  }
  // Called when a YouTube record refuses to play: skip, but don't loop forever on a crate of duds.
  function ytFailed(msg) {
    yt.failures += 1;
    state.playing = false; document.body.classList.remove("playing");
    if (yt.failures >= 3 || tracksIn(state.category).length <= 1) {
      toast(`${msg} · nothing else to play in this crate`);
      state.targetOmega = 0; setArm(ANGLE_REST, { lifted: true, ms: 900 });
      yt.failures = 0;
      return;
    }
    toast(`${msg} · skipping`);
    setTimeout(() => { if (!state.busy) next(); }, 400);
  }
  function ytMeta() {
    const v = yt.player.getVideoData ? yt.player.getVideoData() : null;
    if (!v || !v.video_id) return;
    const t = state.cur;
    if (t.videoNow !== v.video_id) { yt.liveStart = 0; yt.lastDur = 0; yt.isLive = false; }
    t.title = v.title || t.title; t.artist = v.author || "YouTube"; t.videoNow = v.video_id;
    t.cover = `https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`;
    t.covers = [`https://i.ytimg.com/vi/${v.video_id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`];
    renderTrack(t);
    // remember the real title in the crate list (single videos only; playlists keep their generic label)
    const src = state.sources.find((s) => s.url === t.srcKey);
    if (src && src.videoId && v.title && src.label !== v.title) { src.label = v.title; saveSources(); if (!els.crate.hidden) renderCrate(); }
  }
  function ytHasMore(dir) {
    const list = yt.player.getPlaylist ? yt.player.getPlaylist() : null;
    if (!list || !list.length) return false;
    const i = yt.player.getPlaylistIndex();
    return dir > 0 ? i < list.length - 1 : i > 0;
  }
  function ytStartTicker() {
    clearInterval(yt.ticker);
    yt.ticker = setInterval(() => { if (isYT(state.cur)) { updateClock(); if (state.playing) trackArm(); } }, 1000);
  }
  function ytStop() {
    clearInterval(yt.ticker); clearTimeout(yt.endTimer);
    if (yt.player && yt.player.stopVideo) { try { yt.player.stopVideo(); } catch {} }
  }

  // ---------- catalogue / queue ----------
  function tracksIn(cat) { return cat === "yours" ? state.yoursTracks : state.catalog.tracks.filter((t) => t.category === cat); }
  function currentTrack() { return state.queue[state.index]; }
  function buildQueue(cat, first) {
    const all = tracksIn(cat).slice();
    let q = shuffle(all);
    if (first) q = [first, ...q.filter((t) => t !== first)];
    state.queue = q; state.index = -1;
  }
  function pickNext() {
    state.index += 1;
    if (state.index >= state.queue.length) { buildQueue(state.category); state.index = 0; }
    return currentTrack();
  }
  function categories() {
    const cats = state.catalog.categories.slice();
    if (state.sources.length) cats.push({ id: "yours", label: "Yours", tag: "your own links" });
    return cats;
  }

  function renderModes() {
    els.modes.innerHTML = "";
    for (const c of categories()) {
      const b = document.createElement("button");
      b.className = "mode"; b.role = "tab"; b.textContent = c.label; b.title = c.tag;
      b.setAttribute("aria-selected", String(c.id === state.category));
      b.addEventListener("click", () => selectCategory(c.id));
      els.modes.appendChild(b);
    }
    // "Yours" always sits at the end: it selects the crate (when it has records) and opens it.
    const yours = document.createElement("button");
    yours.className = "mode mode-yours"; yours.role = "tab"; yours.title = "Your own music";
    // a little record crate
    yours.innerHTML = '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1.5 3.5h11l-1 7.5h-9z"/><path d="M1 3.5h12M5 6.5h4"/></svg>Yours';
    yours.setAttribute("aria-selected", String(state.category === "yours"));
    yours.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.yoursTracks.length && state.category !== "yours" && !state.busy) selectCategory("yours");
      toggleCrate(true);
    });
    const old = Array.from(els.modes.children).find((b) => b.textContent === "Yours"); if (old) old.remove();
    els.modes.appendChild(yours);
  }
  // Record label art: try each candidate in order, fall back to the Mystery Vinyl label.
  let labelReq = 0;
  function setLabel(urls) {
    const req = ++labelReq;
    const tryAt = (i) => {
      if (i >= urls.length) { if (req === labelReq) els.label.style.backgroundImage = ""; return; }
      const img = new Image();
      img.onload = () => { if (req === labelReq) els.label.style.backgroundImage = `url("${urls[i]}")`; };
      img.onerror = () => tryAt(i + 1);
      img.src = urls[i];
    };
    if (!urls.length) { els.label.style.backgroundImage = ""; return; }
    tryAt(0);
  }
  function renderTrack(t) {
    // YouTube titles usually carry the artist already ("Artist - Song"); don't double it.
    const dup = t.artist && t.title.toLowerCase().startsWith(t.artist.toLowerCase());
    els.title.textContent = t.artist && !dup ? `${t.artist} - ${t.title}` : t.title;
    els.artist.textContent = t.album || "";
    setLabel(t.covers || (t.cover ? [t.cover] : []));
    if (t.kind === "yt") {
      els.credit.innerHTML = `Playing from <a href="${esc(t.source)}" target="_blank" rel="noopener">YouTube</a>${t.category === "yours" ? " · added by you" : ` · ${esc(t.artist || "")}`}`;
    } else if (t.category === "yours" && !t.license) {
      els.credit.innerHTML = `Stream · <a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.host || t.source)}</a> · added by you`;
    } else {
      const lic = (t.license || "").replace(/^https?:\/\/creativecommons\.org\/licenses\//, "CC ").replace(/^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/, "CC0").replace(/\/$/, "").toUpperCase();
      els.credit.innerHTML = `From <a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.album)}</a> on the Internet Archive${lic ? ` · ${lic}` : ""}`;
    }
    document.title = `${t.title}${t.artist ? ` — ${t.artist}` : ""} · Mystery Vinyl`;
    if (!els.crate.hidden) renderCrate();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || "", album: t.album || "", artwork: t.cover ? [{ src: t.cover, sizes: "512x512", type: "image/jpeg" }] : [] });
    }
  }

  // ---------- transport ----------
  async function loadAndPlay(t, { swapRecord = true, ytStepDir = 0 } = {}) {
    if (state.busy) return; state.busy = true;
    try {
      const wasPlaying = state.playing;
      state.playing = false; document.body.classList.remove("playing");
      // 1. lift the arm and return it to the rest; brake the platter (skip = electronic stop)
      state.brake = true; state.targetOmega = 0;
      setArm(ANGLE_REST, { lifted: true, ms: wasPlaying ? 900 : 300 });
      // 2. swap the record while the arm travels
      if (swapRecord) { els.record.classList.add("out"); await wait(420); }
      // stop whichever backend was sounding
      if (isYT(state.cur) && !isYT(t)) ytStop();
      if (!isYT(t)) { if (isYT(state.cur)) { /* nothing */ } }
      else if (state.cur && !isYT(state.cur)) audio.pause();
      state.cur = t; yt.liveStart = 0; yt.lastDur = 0; yt.isLive = false;
      renderTrack(t);
      if (isYT(t)) {
        try { await loadYT(); } catch (err) { toast("YouTube player couldn't load"); state.busy = false; return next(); }
        if (ytStepDir) { yt.player.mute(); ytStepDir > 0 ? yt.player.nextVideo() : yt.player.previousVideo(); }
        else if (t.listId) yt.player.cuePlaylist({ listType: "playlist", list: t.listId });
        else yt.player.cueVideoById(t.videoId);
        ytStartTicker();
      } else {
        audio.src = t.url; audio.load();
      }
      if (swapRecord) { await wait(60); els.record.classList.remove("out"); await wait(380); }
      else await wait(wasPlaying ? 500 : 0);
      // Before the first play, check whether the browser will let us start
      // without a gesture. If not, leave the arm on its rest and wait for a click.
      if (!state.everPlayed && !(await canAutoplay())) { if (ytStepDir) yt.player.pauseVideo(); arm(); return; }
      // 3. swing the arm over the lead-in groove, then drop it
      state.brake = false; state.targetOmega = OMEGA_PLAY;
      setArm(ANGLE_IN, { lifted: true, ms: 1000 });
      await wait(1000);
      setArm(ANGLE_IN, { lifted: false, ms: 300 });
      await wait(250);
      await play();
      if (ytStepDir) yt.player.unMute();
    } finally { state.busy = false; }
  }
  // Probe autoplay with the volume at zero (Chrome treats volume 0 as unmuted,
  // so a rejected promise here means a real play() would be rejected too).
  const FORCE_GATE = /[?&]noautoplay/.test(location.search);
  async function canAutoplay() {
    if (FORCE_GATE) return false;
    if (navigator.userActivation?.hasBeenActive) return true;
    if (isYT(state.cur)) return false;                      // can't probe the iframe; wait for a click
    const v = audio.volume; audio.volume = 0;
    try { await audio.play(); audio.pause(); audio.currentTime = 0; return true; }
    catch { return false; }
    finally { audio.volume = v; }
  }
  async function play() {
    ensureAudioGraph();
    if (isYT(state.cur)) {
      state.targetOmega = OMEGA_PLAY;
      if (yt.player.getPlayerState() === YT.PlayerState.PLAYING) {   // already rolling (e.g. playlist step): nothing to wait for
        state.playing = true; state.everPlayed = true; document.body.classList.add("playing");
        disarm(); ytMeta(); updateClock(); trackArm();
        return;
      }
      const waiting = ytAwaitPlaying();
      yt.player.playVideo();            // state.playing flips in onYTState(PLAYING)
      try { await waiting; }
      catch (err) {
        if (err.message === "timeout" && !navigator.userActivation?.hasBeenActive) { state.targetOmega = 0; setArm(ANGLE_REST, { lifted: true, ms: 600 }); arm(); }
        else ytFailed(err.message === "timeout" ? "YouTube didn't start" : err.message);
      }
      return;
    }
    try {
      await audio.play();
      state.playing = true; state.everPlayed = true; document.body.classList.add("playing");
      state.targetOmega = OMEGA_PLAY;
      disarm();
      trackArm();
    } catch (err) {
      // Should only happen if play() was called with no gesture: park the arm
      // and wait for a click anywhere on the page.
      state.targetOmega = 0;
      setArm(ANGLE_REST, { lifted: true, ms: 600 });
      arm();
    }
  }
  function arm() {
    if (state.armed) return; state.armed = true;
    document.body.classList.add("armed"); els.hint.hidden = false;
    document.addEventListener("pointerdown", onFirstGesture, true);
    document.addEventListener("keydown", onFirstGesture, true);
  }
  function disarm() {
    if (!state.armed) return; state.armed = false;
    document.body.classList.remove("armed"); els.hint.hidden = true;
    document.removeEventListener("pointerdown", onFirstGesture, true);
    document.removeEventListener("keydown", onFirstGesture, true);
  }
  async function onFirstGesture(e) {
    if (e.target.closest && e.target.closest("a, input, .mode, #next, #prev, #crate")) { disarm(); return; }
    disarm();
    if (state.busy || state.playing) return;
    await resume();
  }
  function pause() {
    if (isYT(state.cur)) { yt.player && yt.player.pauseVideo(); } else audio.pause();
    state.playing = false; document.body.classList.remove("playing");
    state.brake = false; state.targetOmega = 0;   // power-off style coast
    setArm(ANGLE_REST, { lifted: true, ms: 900 });
  }
  // Resume from the rest: platter up to speed, arm over the groove we left, drop, sound.
  async function resume() {
    if (state.busy || !state.cur) return; state.busy = true;
    try {
      ensureAudioGraph();
      state.brake = false; state.targetOmega = OMEGA_PLAY;
      setArm(grooveAngle(), { lifted: true, ms: 900 });
      await wait(900);
      setArm(grooveAngle(), { lifted: false, ms: 300 });
      await wait(250);
    } finally { state.busy = false; }
    await play();
  }
  function toggle() { if (state.busy) return; state.playing ? pause() : resume(); }
  function next() {
    if (isYT(state.cur) && state.cur.listId && yt.player && ytHasMore(1)) return ytStep(1);
    const t = pickNext(); state.history.push(t); return loadAndPlay(t);
  }
  function ytStep(dir) { return loadAndPlay(state.cur, { swapRecord: true, ytStepDir: dir }); }
  function prev() {
    const { t } = pos();
    if (isYT(state.cur) && state.cur.listId && yt.player && t <= 8 && ytHasMore(-1)) return ytStep(-1);
    if (t > 8 || state.history.length < 2) { seek(0); trackArm(); return; }
    state.history.pop(); const tr = state.history[state.history.length - 1];
    state.index = Math.max(0, state.queue.indexOf(tr));
    return loadAndPlay(tr);
  }
  function selectCategory(id, first) {
    if (state.busy || (id === state.category && !first)) return;
    state.category = id; store.set("mv.category", id);
    renderModes(); buildQueue(id, first);
    const t = pickNext(); state.history.push(t); return loadAndPlay(t);   // straight from the queue, never a playlist step
  }

  // ---------- "Yours": user-added sources ----------
  function parseSource(text) {
    let u; try { u = new URL(text.trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.replace(/^(www|m|music)\./, "");
    if (h === "youtube.com" || h === "youtu.be" || h === "youtube-nocookie.com") {
      const list = u.searchParams.get("list");
      let v = u.searchParams.get("v");
      if (h === "youtu.be") v = u.pathname.slice(1).split("/")[0];
      const m = u.pathname.match(/^\/(live|shorts|embed|v)\/([\w-]{11})/); if (m) v = m[2];
      if (list) return { kind: "yt", listId: list, url: u.href, label: "YouTube playlist" };
      if (v && /^[\w-]{11}$/.test(v)) return { kind: "yt", videoId: v, url: u.href, label: "YouTube video" };
      return null;
    }
    if (h === "archive.org") {
      const m = u.pathname.match(/^\/(details|download)\/([^/]+)/);
      return m ? { kind: "ia", id: m[2], url: `https://archive.org/details/${m[2]}`, label: m[2] } : null;
    }
    return { kind: "audio", url: u.href, label: decodeURIComponent(u.pathname.split("/").pop() || u.hostname) || u.hostname, host: u.hostname };
  }
  const iaCache = new Map();
  async function iaTracks(src) {
    if (iaCache.has(src.id)) return iaCache.get(src.id);
    const r = await fetch(`https://archive.org/metadata/${src.id}`); const d = await r.json();
    const m = d.metadata || {}; const files = d.files || [];
    const album = String(m.title || src.id).replace(/^\[[^\]]+\]\s*/, "");
    let artist = m.creator || ""; if (Array.isArray(artist)) artist = artist[0];
    const imgs = files.filter((f) => (f.format === "JPEG" || f.format === "PNG") && f.source === "original").map((f) => f.name);
    const cover = imgs.find((n) => /front|folder/i.test(n)) || imgs.find((n) => /cover|art/i.test(n) && !/back|tray/i.test(n)) || imgs[0] || "__ia_thumb.jpg";
    const seen = new Set(); const out = [];
    for (const f of files.slice().sort((a, b) => (a.format === "VBR MP3" ? 0 : 1) - (b.format === "VBR MP3" ? 0 : 1))) {
      if (!/\.mp3$/i.test(f.name) || !/MP3/.test(f.format || "")) continue;
      const stem = f.name.replace(/\.mp3$/i, "").replace(/_(vbr|64kb|128kb)$/i, "");
      if (seen.has(stem)) continue; seen.add(stem);
      const len = String(f.length || "0");
      const secs = len.includes(":") ? len.split(":").reverse().reduce((s, x, i) => s + parseFloat(x) * 60 ** i, 0) : parseFloat(len);
      if (!(secs >= 60)) continue;
      const ta = f.artist || f.creator || artist || "";
      let title = (f.title || stem).replace(/_/g, " ").trim();
      if (ta && title.toLowerCase().startsWith(ta.toLowerCase())) title = title.slice(ta.length).trim().replace(/^-\s*/, "");
      title = title.replace(/^\d{1,3}\s*[-_.)]\s*/, "").replace(/\s*\[\d{4}\]\s*$/, "") || stem;
      out.push({ kind: "audio", category: "yours", title, artist: ta, album, duration: Math.round(secs),
        url: `https://archive.org/download/${src.id}/${encodeURIComponent(f.name)}`,
        cover: `https://archive.org/download/${src.id}/${encodeURIComponent(cover)}`,
        source: src.url, license: m.licenseurl || "", srcKey: src.url });
    }
    if (!out.length) throw new Error("no mp3s in that item");
    src.label = album;
    iaCache.set(src.id, out);
    return out;
  }
  function sourceTracks(src) {
    if (src.kind === "yt") return [{ kind: "yt", category: "yours", videoId: src.videoId, listId: src.listId, title: src.label, artist: "", album: "YouTube",
      cover: src.videoId ? `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg` : "",
      covers: src.videoId ? [`https://i.ytimg.com/vi/${src.videoId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg`] : [],
      source: src.url, srcKey: src.url }];
    if (src.kind === "audio") return [{ kind: "audio", category: "yours", title: src.label, artist: "", album: src.host, cover: "", url: src.url, source: src.url, host: src.host, srcKey: src.url }];
    return iaCache.get(src.id) || [];
  }
  async function expandSources() {
    const out = [];
    for (const s of state.sources) {
      if (s.kind === "ia") { try { out.push(...await iaTracks(s)); } catch (e) { console.warn("archive item failed", s.id, e); } }
      else out.push(...sourceTracks(s));
    }
    state.yoursTracks = out;
  }
  function saveSources() { store.set("mv.sources", JSON.stringify(state.sources)); }
  function loadSources() { try { state.sources = JSON.parse(store.get("mv.sources") || "[]"); } catch { state.sources = []; } }

  function toggleCrate(force) {
    const open = force ?? els.crate.hidden;
    els.crate.hidden = !open;
    if (open) { renderCrate(); setTimeout(() => els.crateInput.focus(), 50); }
  }
  function renderCrate() {
    const now = state.cur && state.cur.srcKey;
    els.crateList.innerHTML = state.sources.map((s, i) => `
      <li class="crate-item${s.url === now ? " is-playing" : ""}">
        <span class="crate-kind">${s.kind === "yt" ? "YouTube" : s.kind === "ia" ? "Archive" : "Stream"}</span>
        <button class="crate-name" data-i="${i}" title="Play">${esc(s.label || s.url)}</button>
        <a class="crate-open" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open the link" aria-label="Open the link">
          <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>
        </a>
        <button class="crate-remove" data-i="${i}" aria-label="Remove">×</button>
      </li>`).join("") || `<li class="crate-empty">Nothing here yet. Paste a link above.</li>`;
  }
  function playSource(i) {
    const src = state.sources[i]; if (!src || state.busy) return;
    const first = state.yoursTracks.find((t) => t.srcKey === src.url);
    if (!first) { toast("Nothing playable in that one"); return; }
    if (state.cur === first && state.playing) return;
    selectCategory("yours", first);
    renderCrate();
  }
  async function addSource(text) {
    const src = parseSource(text);
    if (!src) { toast("That doesn't look like a link I can play"); return; }
    if (state.sources.some((s) => s.url === src.url)) { toast("Already in your crate"); return; }
    if (src.kind === "ia") {
      toast("Reading the album…");
      try { await iaTracks(src); } catch { toast("Couldn't find playable MP3s in that archive.org item"); return; }
    }
    state.sources.push(src); saveSources();
    await expandSources();
    els.crateInput.value = "";
    renderCrate(); toast(`Added · ${src.label}`);
    const first = state.yoursTracks.find((t) => t.srcKey === src.url);
    if (state.busy) return;
    selectCategory("yours", first);
  }
  async function removeSource(i) {
    const [gone] = state.sources.splice(i, 1); saveSources();
    await expandSources(); renderCrate();
    if (!state.sources.length) {
      toggleCrate(false);
      if (state.category === "yours") selectCategory(state.catalog.categories[0].id);
      else renderModes();
    } else {
      renderModes();
      if (state.category === "yours") { const wasCur = state.cur && state.cur.srcKey === gone.url; buildQueue("yours"); if (wasCur) next(); }
    }
  }
  els.crateForm.addEventListener("submit", (e) => { e.preventDefault(); addSource(els.crateInput.value); });
  els.crateList.addEventListener("click", (e) => {
    const rm = e.target.closest(".crate-remove"); if (rm) return removeSource(+rm.dataset.i);
    const pl = e.target.closest(".crate-name"); if (pl) playSource(+pl.dataset.i);
  });
  document.addEventListener("pointerdown", (e) => { if (!els.crate.hidden && !e.target.closest("#crate, .mode-yours")) toggleCrate(false); });

  // ---------- events ----------
  audio.addEventListener("timeupdate", () => { if (isYT(state.cur)) return; updateClock(); if (Math.floor(audio.currentTime) % 3 === 0) trackArm(); });
  audio.addEventListener("durationchange", () => { if (!isYT(state.cur)) updateClock(); });
  audio.addEventListener("ended", () => { if (!isYT(state.cur)) next(); });
  audio.addEventListener("error", () => { if (isYT(state.cur) || !audio.src) return; console.warn("track failed, skipping", audio.error); toast("Couldn't play that · skipping"); if (!state.busy) next(); });
  audio.addEventListener("waiting", () => { if (!isYT(state.cur)) state.targetOmega = state.playing ? OMEGA_PLAY * 0.97 : 0; });
  audio.addEventListener("playing", () => { if (!isYT(state.cur)) state.targetOmega = OMEGA_PLAY; });

  els.play.addEventListener("click", toggle);
  els.power.addEventListener("click", toggle);
  els.next.addEventListener("click", () => !state.busy && next());
  els.prev.addEventListener("click", () => !state.busy && prev());
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowRight") { if (!state.busy) next(); }
    else if (e.code === "ArrowLeft") { if (!state.busy) prev(); }
    else if (e.key === "f" || e.key === "F") toggleZen();
    else if (e.key === "t" || e.key === "T") toggleTheme();
    else if (e.key === "n" || e.key === "N") toggleCrackle();
    else if (e.key === "Escape") {
      if (!els.crate.hidden) toggleCrate(false);
      else if (document.body.classList.contains("zen") && !document.fullscreenElement) setZen(false);
    }
  });
  els.crateInput.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleCrate(false); });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    els.toast.textContent = msg; els.toast.classList.remove("leaving"); els.toast.hidden = false;
    toastTimer = setTimeout(() => { els.toast.classList.add("leaving"); setTimeout(() => { els.toast.hidden = true; }, 300); }, 1600);
  }

  // ---------- theme ----------
  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    store.set("mv.theme", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#FBF7F1" : "#202020");
    refreshWaveColors();
    toast(light ? "Light theme" : "Dark theme");
  }
  els.theme.addEventListener("click", toggleTheme);
  els.crackle.addEventListener("click", toggleCrackle);
  els.crackle.setAttribute("aria-pressed", String(crackle.on));
  els.crackle.dataset.tip = crackle.on ? "Vinyl crackle on · N" : "Vinyl crackle off · N";
  if (document.documentElement.dataset.theme === "light") document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FBF7F1");

  // ---------- zen / full screen ----------
  let idleTimer;
  function setZen(on) {
    const was = document.body.classList.contains("zen");
    document.body.classList.toggle("zen", on);
    if (on && !was) toast("Full screen · move the mouse to show controls, Esc to exit");
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    if (on) idleTimer = setTimeout(() => document.body.classList.add("idle"), 3000);
  }
  function toggleZen() {
    const on = !document.body.classList.contains("zen");
    if (document.fullscreenEnabled) {
      (on ? document.documentElement.requestFullscreen() : document.exitFullscreen()).catch(() => setZen(on));
    } else setZen(on);   // iOS Safari: same layout, no real full screen
  }
  document.addEventListener("fullscreenchange", () => setZen(!!document.fullscreenElement));
  els.zen.addEventListener("click", toggleZen);
  document.addEventListener("pointermove", () => {
    if (!document.body.classList.contains("zen")) return;
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add("idle"), 3000);
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => resume());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
  }

  window.__mv = { state, audio, crackle, yt, addSource, parseSource, get ctx() { return ctx; }, get analyser() { return analyser; }, get data() { return data; } };

  // ---------- boot ----------
  fetch("data/catalog.json").then((r) => r.json()).then(async (cat) => {
    state.catalog = cat;
    loadSources();
    await expandSources();
    const saved = store.get("mv.category");
    const ids = categories().map((c) => c.id);
    state.category = ids.includes(saved) && tracksIn(saved).length ? saved : cat.categories[0].id;
    renderModes(); buildQueue(state.category);
    next();
  }).catch((e) => { els.title.textContent = "Could not load the record crate."; console.error(e); });
})();
