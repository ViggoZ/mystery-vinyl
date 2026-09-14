/* Mystery Vinyl — random records for coding, focus, thinking and designing. */
(() => {
  const $ = (s) => document.querySelector(s);
  const audio = $("#audio");
  const els = {
    modes: $("#modes"), wave: $("#wave"), cur: $("#cur"), dur: $("#dur"),
    title: $("#title"), artist: $("#artist"), credit: $("#credit"),
    play: $("#play"), prev: $("#prev"), next: $("#next"), power: $("#power"),
    theme: $("#theme"), zen: $("#zen"),
    arm: $("#arm"), armWobble: $("#armWobble"), record: $("#record"), label: $("#label"), platter: $("#platter"),
    hint: $("#hint"),
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
    catalog: null, category: null, queue: [], index: -1,
    playing: false, targetOmega: 0, brake: false, busy: false, armed: false, everPlayed: false,
    omega: 0, angle: 0,              // platter (motor-driven)
    recOmega: 0, recAngle: 0,        // record: sits on the mat, slips a little against it
    history: [],
  };

  // ---------- helpers ----------
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

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
    drawWave();
    requestAnimationFrame(spin);
  }
  requestAnimationFrame(spin);

  // ---------- tonearm ----------
  function setArm(deg, { lifted = false, ms = 1100 } = {}) {
    els.arm.style.transitionDuration = `${ms}ms, 400ms`;
    els.arm.classList.toggle("lifted", lifted);
    els.arm.style.transform = `rotate(${deg}deg)`;
  }
  function trackArm() {
    if (!state.playing || !audio.duration) return;
    const p = audio.currentTime / audio.duration;
    setArm(ANGLE_IN + (ANGLE_OUT - ANGLE_IN) * p, { lifted: false, ms: 900 });
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
    } catch (e) { console.warn("Web Audio unavailable", e); }
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
  function drawWave() {
    const W = els.wave.width, H = els.wave.height, gap = 8, bw = (W - gap * (BARS - 1)) / BARS;
    wctx.clearRect(0, 0, W, H);
    let levels = idle;
    if (analyser && state.playing) {
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
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    for (let i = 0; i < BARS; i++) {
      const h = Math.max(4, levels[i] * H);
      wctx.fillStyle = i / BARS < progress ? waveOn : waveOff;
      wctx.fillRect(i * (bw + gap), H - h, bw, h);
    }
  }
  els.wave.addEventListener("click", (e) => {
    if (!audio.duration) return;
    const r = els.wave.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    trackArm();
  });

  // ---------- catalogue / queue ----------
  function tracksIn(cat) { return state.catalog.tracks.filter((t) => t.category === cat); }
  function currentTrack() { return state.queue[state.index]; }
  function buildQueue(cat) {
    state.queue = shuffle(tracksIn(cat).slice());
    state.index = -1;
  }
  function pickNext() {
    state.index += 1;
    if (state.index >= state.queue.length) { buildQueue(state.category); state.index = 0; }
    return currentTrack();
  }

  function renderModes() {
    els.modes.innerHTML = "";
    for (const c of state.catalog.categories) {
      const b = document.createElement("button");
      b.className = "mode"; b.role = "tab"; b.textContent = c.label; b.title = c.tag;
      b.setAttribute("aria-selected", String(c.id === state.category));
      b.addEventListener("click", () => selectCategory(c.id));
      els.modes.appendChild(b);
    }
  }
  function renderTrack(t) {
    els.title.textContent = `${t.artist} - ${t.title}`;
    els.artist.textContent = t.album;
    els.label.style.backgroundImage = `url("${t.cover}")`;
    const lic = (t.license || "").replace(/^https?:\/\/creativecommons\.org\/licenses\//, "CC ").replace(/^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/, "CC0").replace(/\/$/, "").toUpperCase();
    els.credit.innerHTML = `From <a href="${t.source}" target="_blank" rel="noopener">${t.album}</a> on the Internet Archive${lic ? ` · ${lic}` : ""}`;
    document.title = `${t.title} — ${t.artist} · Mystery Vinyl`;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: t.cover, sizes: "512x512", type: "image/jpeg" }] });
    }
  }

  // ---------- transport ----------
  async function loadAndPlay(t, { swapRecord = true } = {}) {
    if (state.busy) return; state.busy = true;
    try {
      const wasPlaying = state.playing;
      state.playing = false; document.body.classList.remove("playing");
      // 1. lift the arm and return it to the rest; brake the platter (skip = electronic stop)
      state.brake = true; state.targetOmega = 0;
      setArm(ANGLE_REST, { lifted: true, ms: wasPlaying ? 900 : 300 });
      // 2. swap the record while the arm travels
      if (swapRecord) { els.record.classList.add("out"); await wait(420); }
      renderTrack(t);
      audio.src = t.url; audio.load();
      if (swapRecord) { await wait(60); els.record.classList.remove("out"); await wait(380); }
      else await wait(wasPlaying ? 500 : 0);
      // Before the first play, check whether the browser will let us start
      // without a gesture. If not, leave the arm on its rest and wait for a click.
      if (!state.everPlayed && !(await canAutoplay())) { arm(); return; }
      // 3. swing the arm over the lead-in groove, then drop it
      state.brake = false; state.targetOmega = OMEGA_PLAY;
      setArm(ANGLE_IN, { lifted: true, ms: 1000 });
      await wait(1000);
      setArm(ANGLE_IN, { lifted: false, ms: 300 });
      await wait(250);
      await play();
    } finally { state.busy = false; }
  }
  // Probe autoplay with the volume at zero (Chrome treats volume 0 as unmuted,
  // so a rejected promise here means a real play() would be rejected too).
  const FORCE_GATE = /[?&]noautoplay/.test(location.search);
  async function canAutoplay() {
    if (FORCE_GATE) return false;
    if (navigator.userActivation?.hasBeenActive) return true;
    const v = audio.volume; audio.volume = 0;
    try { await audio.play(); audio.pause(); audio.currentTime = 0; return true; }
    catch { return false; }
    finally { audio.volume = v; }
  }
  async function play() {
    ensureAudioGraph();
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
    if (e.target.closest && e.target.closest("a, input, .mode, #next, #prev")) { disarm(); return; }
    disarm();
    if (state.busy || state.playing) return;
    await resume();
  }
  function grooveAngle() {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    return ANGLE_IN + (ANGLE_OUT - ANGLE_IN) * p;
  }
  function pause() {
    audio.pause();
    state.playing = false; document.body.classList.remove("playing");
    state.brake = false; state.targetOmega = 0;   // power-off style coast
    setArm(ANGLE_REST, { lifted: true, ms: 900 });
  }
  // Resume from the rest: platter up to speed, arm over the groove we left, drop, sound.
  async function resume() {
    if (state.busy || !audio.src) return; state.busy = true;
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
  function next() { const t = pickNext(); state.history.push(t); return loadAndPlay(t); }
  function prev() {
    if (audio.currentTime > 8 || state.history.length < 2) { audio.currentTime = 0; trackArm(); return; }
    state.history.pop(); const t = state.history[state.history.length - 1];
    state.index = Math.max(0, state.queue.indexOf(t));
    return loadAndPlay(t);
  }
  function selectCategory(id) {
    if (state.busy || id === state.category) return;
    state.category = id; store.set("mv.category", id);
    renderModes(); buildQueue(id); next();
  }

  // ---------- events ----------
  audio.addEventListener("timeupdate", () => { els.cur.textContent = fmt(audio.currentTime); if (Math.floor(audio.currentTime) % 3 === 0) trackArm(); });
  audio.addEventListener("durationchange", () => { els.dur.textContent = fmt(audio.duration); });
  audio.addEventListener("ended", () => next());
  audio.addEventListener("error", () => { console.warn("track failed, skipping", audio.error); if (!state.busy) next(); });
  audio.addEventListener("waiting", () => { state.targetOmega = state.playing ? OMEGA_PLAY * 0.97 : 0; });
  audio.addEventListener("playing", () => { state.targetOmega = OMEGA_PLAY; });

  els.play.addEventListener("click", toggle);
  els.power.addEventListener("click", toggle);
  els.next.addEventListener("click", () => !state.busy && next());
  els.prev.addEventListener("click", () => !state.busy && prev());
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowRight") { if (!state.busy) next(); }
    else if (e.code === "ArrowLeft") { if (!state.busy) prev(); }
    else if (e.key === "f" || e.key === "F") toggleZen();
    else if (e.key === "t" || e.key === "T") toggleTheme();
    else if (e.key === "Escape" && document.body.classList.contains("zen") && !document.fullscreenElement) setZen(false);
  });

  // ---------- theme ----------
  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    store.set("mv.theme", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#FBF7F1" : "#202020");
    refreshWaveColors();
  }
  els.theme.addEventListener("click", toggleTheme);
  if (document.documentElement.dataset.theme === "light") document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FBF7F1");

  // ---------- zen / full screen ----------
  let idleTimer;
  function setZen(on) {
    document.body.classList.toggle("zen", on);
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

  window.__mv = { state, audio, get analyser() { return analyser; }, get data() { return data; } };

  // ---------- boot ----------
  fetch("data/catalog.json").then((r) => r.json()).then((cat) => {
    state.catalog = cat;
    const saved = store.get("mv.category");
    state.category = cat.categories.some((c) => c.id === saved) ? saved : cat.categories[0].id;
    renderModes(); buildQueue(state.category);
    next();
  }).catch((e) => { els.title.textContent = "Could not load the record crate."; console.error(e); });
})();
