/* Window radio — look out of a window in any city, right now. The live weather decides the sky, the room sounds
   and what the radio on the sill plays. Weather: Open-Meteo. Place names for "here": BigDataCloud. */
(() => {
  const $ = (s) => document.querySelector(s);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pad = (n) => String(n).padStart(2, "0");
  const ICON = (name) => `<svg aria-hidden="true"><use href="assets/pixelarticons.svg#${name}"></use></svg>`;

  const audio = $("#audio");
  const els = {
    clock: $("#clock"), city: $("#city"), cond: $("#cond"), blurb: $("#blurb"), sun: $("#sun"), layers: $("#layers"), balance: $("#balance"), credit: $("#credit"),
    room: $("#room"), scene: $("#scene"), play: $("#play"), prev: $("#prev"), next: $("#next"), title: $("#title"), artist: $("#artist"),
    chips: $("#chips"), search: $("#search"), q: $("#q"), theme: $("#theme"), toast: $("#toast"),
  };

  // ---------- places ----------
  const PLACES = [
    { slug: "shanghai", name: "Shanghai", lat: 31.23, lon: 121.47 },
    { slug: "tokyo", name: "Tokyo", lat: 35.68, lon: 139.69 },
    { slug: "paris", name: "Paris", lat: 48.86, lon: 2.35 },
    { slug: "london", name: "London", lat: 51.51, lon: -0.13 },
    { slug: "new-york", name: "New York", lat: 40.71, lon: -74.01 },
    { slug: "reykjavik", name: "Reykjavík", lat: 64.15, lon: -21.94 },
    { slug: "sydney", name: "Sydney", lat: -33.87, lon: 151.21 },
    { slug: "honolulu", name: "Honolulu", lat: 21.31, lon: -157.86 },
  ];
  // every city gets its own station on the dial
  const freqFor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 88.1 + (h % 100) * .2; };

  // ---------- weather ----------
  const WMO = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Heavy showers", 82: "Violent showers",
    85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
  };
  const RAIN = { 51: .2, 53: .3, 55: .45, 56: .3, 57: .45, 61: .4, 63: .65, 65: .95, 66: .5, 67: .8, 80: .5, 81: .75, 82: 1, 95: .9, 96: 1, 99: 1 };
  const SNOW = { 71: .35, 73: .6, 75: .9, 77: .3, 85: .5, 86: .85 };
  const FOG = { 45: .7, 48: .8 };
  function derive(c) {
    const code = c.weather_code ?? 0;
    return { code, cloud: c.cloud_cover ?? 0, wind: c.wind_speed_10m ?? 0, temp: c.temperature_2m ?? 18, rain: RAIN[code] || 0, snow: SNOW[code] || 0, fog: FOG[code] || 0, thunder: code >= 95 };
  }
  const CALM = derive({ weather_code: 1, cloud_cover: 20, wind_speed_10m: 6, temperature_2m: 18 });

  const state = {
    place: null, wx: CALM, offset: null, sunrise: "", sunset: "", want: false, level: 0,
    pool: [], recent: [], back: [], track: null, mood: null, layers: {}, balance: clamp(parseFloat(store.get("mv.window.balance") ?? ".5")),
  };

  // local hour at the window: from the weather's UTC offset, or the longitude as a first guess
  function localNow() {
    const off = state.offset ?? Math.round((state.place?.lon ?? 0) / 15) * 3600;
    return new Date(Date.now() + off * 1000);
  }
  const localHour = () => { const d = localNow(); return d.getUTCHours() + d.getUTCMinutes() / 60; };

  async function fetchWeather(p) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const j = await (await fetch(u)).json();
    if (!j.current) throw new Error("no weather");
    return j;
  }
  async function geocode(name) {
    const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`)).json();
    const r = j.results && j.results[0];
    if (!r) return null;
    return { slug: slug(r.name), name: r.name, lat: r.latitude, lon: r.longitude, country: r.country };
  }

  let weatherTimer, placeToken = 0;
  async function setPlace(p, { quiet = false } = {}) {
    const token = ++placeToken;
    state.place = p; state.offset = null; state.freq = freqFor(p.slug);
    store.set("mv.window.place", JSON.stringify(p));
    try { history.replaceState(null, "", `#${p.slug}`); } catch {}
    els.city.textContent = p.name;
    els.cond.innerHTML = "&nbsp;"; els.sun.innerHTML = "&nbsp;";
    renderChips();
    if (!quiet) tune();
    try {
      const j = await fetchWeather(p);
      if (token !== placeToken) return;
      state.wx = derive(j.current); state.offset = j.utc_offset_seconds;
      state.sunrise = (j.daily?.sunrise?.[0] || "").slice(11); state.sunset = (j.daily?.sunset?.[0] || "").slice(11);
    } catch (e) {
      console.warn(e); if (token !== placeToken) return;
      state.wx = CALM; toast("Couldn't reach the weather, so it's a calm day");
    }
    describe(); mixRoom(); pickMood();
    clearTimeout(weatherTimer); weatherTimer = setTimeout(() => setPlace(state.place, { quiet: true }), 10 * 60 * 1000);
  }

  // ---------- the words ----------
  function describe() {
    const w = state.wx, h = localHour(), p = state.place;
    els.cond.textContent = `${WMO[w.code] ?? "Weather"} · ${Math.round(w.temp)}°C · wind ${Math.round(w.wind)} km/h`;
    els.sun.textContent = state.sunrise ? `Sunrise ${state.sunrise} · Sunset ${state.sunset}` : "";
    const tod = h < 5 ? "late night" : h < 8 ? "early morning" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
    const temp = w.temp < 0 ? "freezing" : w.temp < 8 ? "cold" : w.temp < 16 ? "cool" : w.temp < 22 ? "mild" : w.temp < 28 ? "warm" : "hot";
    const sky = w.thunder ? "stormy" : w.snow ? "snowy" : w.rain > .5 ? "rainy" : w.rain ? "drizzly" : w.fog ? "foggy" : w.cloud > 80 ? "grey" : w.cloud > 40 ? "cloudy" : "clear";
    const heard = Object.entries(state.layers).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => LAYERS[id].toLowerCase());
    els.blurb.textContent = `It's a ${temp}, ${sky} ${tod} in ${p.name}.` + (heard.length ? ` Through the glass: ${heard.join(" and ")}.` : "") + (state.mood ? ` The radio is on ${state.mood.label.toLowerCase()}.` : "");
  }

  // ---------- the room: which window sounds, and how loud ----------
  const LAYERS = {
    "rain-on-window": "Rain on the glass", "heavy-rain": "A downpour", thunder: "Thunder, far off", wind: "Wind", "howling-wind": "A gale",
    birds: "Birds", crickets: "Crickets", "night-village": "The quiet night", campfire: "The fire inside", "busy-street": "The street below", "wind-in-trees": "Trees moving",
  };
  function layersFor() {
    const w = state.wx, h = localHour(), p = state.place, sun = WArt.sunPos(Date.now(), p.lat, p.lon), day = sun.el > -2, L = {};
    if (w.rain) L["rain-on-window"] = .35 + .45 * w.rain;
    if (w.rain > .6) L["heavy-rain"] = (w.rain - .5) * .9;
    if (w.thunder) L.thunder = .6;
    if (w.wind > 45) L["howling-wind"] = .45; else if (w.wind > 22) L.wind = clamp((w.wind - 22) / 25) * .45 + .15; else if (w.wind > 10 && !w.rain) L["wind-in-trees"] = .22;
    if (!w.rain && !w.snow) {
      if (day) L.birds = h >= 5 && h < 11 ? .4 : .14;
      else if (w.temp > 12) L.crickets = .35; else L["night-village"] = .25;
      if (day && h >= 8 && h < 20) L["busy-street"] = .1;
    }
    if (w.temp < 6) L.campfire = .35;
    return L;
  }
  function mixRoom() {
    state.layers = layersFor();
    if (ctx) for (const id of new Set([...Object.keys(state.layers), ...Object.keys(amb)])) ambSet(id, (state.layers[id] || 0) * (state.want ? 1 : 0));
    renderLayers(); describe();
  }
  function renderLayers() {
    const rows = Object.entries(state.layers).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<li><span>${esc(LAYERS[id])}</span><i class="wr-bar" style="--p:${Math.round(v * 100)}%"></i></li>`);
    const radio = state.mood ? `<li class="is-radio"><span>Radio · ${esc(state.mood.label)}</span><i class="wr-bar" style="--p:${state.want ? 70 : 0}%"></i></li>` : "";
    els.layers.innerHTML = radio + (rows.join("") || `<li class="is-quiet"><span>Nothing much. A still, quiet window.</span><i></i></li>`);
  }

  // ---------- the radio: what it plays depends on the hour and the weather ----------
  function moodFor() {
    const h = localHour(), w = state.wx;
    if (h >= 23 || h < 5) return { cat: "night", label: "Late-night radio" };
    if (w.thunder || w.rain > .1) return { cat: "lofi", label: "Rainy-day lo-fi" };
    if (w.snow > .1) return { cat: "night", label: "Snowed-in ambient" };
    if (h < 11) return { cat: "focus", label: "Morning jazz" };
    if (h < 18) return w.cloud > 70 ? { cat: "lofi", label: "Grey-afternoon lo-fi" } : { cat: "chill", label: "Sunny-afternoon chill" };
    return { cat: "lofi", label: "Evening lo-fi" };
  }
  function pickMood() {
    const m = moodFor(), changed = !state.mood || state.mood.cat !== m.cat;
    state.mood = m; renderLayers(); describe();
    if (changed && (!state.track || audio.paused)) setTrack(pick());       // a playing record finishes; the next one fits the new window
  }
  let catalog = [];
  async function loadCatalog() {
    try { catalog = (await (await fetch("data/catalog.json")).json()).tracks.filter((t) => t.provider === "audius" && t.url); } catch (e) { console.warn(e); }
  }
  function pick() {
    const pool = catalog.filter((t) => t.category === (state.mood?.cat || "lofi"));
    const all = pool.length ? pool : catalog;
    if (!all.length) return null;
    const fresh = all.filter((t) => !state.recent.includes(t.id)), from = fresh.length ? fresh : all;
    const t = from[Math.floor(Math.random() * from.length)];
    state.recent = [t.id, ...state.recent].slice(0, 16);
    return t;
  }
  function setTrack(t) {
    if (!t) return;
    state.track = t; audio.src = t.url;
    els.title.textContent = t.title; els.artist.textContent = t.artist;
    els.credit.innerHTML = `<a href="${esc(t.source)}" target="_blank" rel="noopener">${esc(t.title)}</a> by ${esc(t.artist)} · ${esc(t.album)} on Audius. Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.`;
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: `Window radio · ${state.place?.name ?? ""}`, artwork: t.cover ? [{ src: t.cover, sizes: "480x480" }] : [] });
  }

  // ---------- audio ----------
  let ctx, master, musicGain, ambBus, analyser, tdata;
  const amb = {};                                                          // id -> { gain, src, buf, loading }
  const buffers = {};
  function ensureGraph() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); analyser = ctx.createAnalyser(); analyser.fftSize = 1024; tdata = new Uint8Array(analyser.fftSize);
      master.connect(analyser).connect(ctx.destination);
      musicGain = ctx.createGain(); ambBus = ctx.createGain();
      ctx.createMediaElementSource(audio).connect(musicGain).connect(master);
      ambBus.connect(master);
      applyBalance();
    } catch (e) { console.warn("Web Audio unavailable", e); ctx = null; }
  }
  async function buffer(id) {
    if (!buffers[id]) buffers[id] = fetch(`assets/sounds/${id}.mp3`).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a));
    return buffers[id];
  }
  async function ambSet(id, level) {
    let a = amb[id];
    if (!a) {
      if (level <= 0) return;
      a = amb[id] = { gain: ctx.createGain(), src: null };
      a.gain.gain.value = 0; a.gain.connect(ambBus);
    }
    a.target = level;
    if (level > 0 && !a.src) {
      try {
        const buf = await buffer(id);
        if (a.src || !(a.target > 0)) return;
        a.src = ctx.createBufferSource(); a.src.buffer = buf; a.src.loop = true; a.src.connect(a.gain); a.src.start(0, Math.random() * buf.duration);
      } catch (e) { console.warn("sound", id, e); return; }
    }
    a.gain.gain.cancelScheduledValues(ctx.currentTime);
    a.gain.gain.setTargetAtTime(a.target, ctx.currentTime, 1.2);
    if (a.target <= 0 && a.src) { const s = a.src; clearTimeout(a.stop); a.stop = setTimeout(() => { if (a.src === s && !(a.target > 0)) { try { s.stop(); } catch {} a.src = null; } }, 6000); }
  }
  function applyBalance() {
    if (!ctx) return;
    const b = state.balance, t = ctx.currentTime;
    musicGain.gain.setTargetAtTime(Math.min(1, 2 * (1 - b)), t, .08);
    ambBus.gain.setTargetAtTime(Math.min(1, 2 * b), t, .08);
  }
  // changing city: turn the dial through some static, like finding a new station
  async function tune() {
    if (!ctx || !state.want) return;
    try {
      const buf = await buffer("tuning-radio"), t = ctx.currentTime;
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.connect(g).connect(master);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.35, t + .08); g.gain.setValueAtTime(.35, t + 1.1); g.gain.linearRampToValueAtTime(0, t + 1.5);
      s.start(t, Math.random() * Math.max(0, buf.duration - 2)); s.stop(t + 1.6);
      musicGain.gain.cancelScheduledValues(t); musicGain.gain.setTargetAtTime(.12, t, .05); musicGain.gain.setTargetAtTime(Math.min(1, 2 * (1 - state.balance)), t + 1.2, .25);
    } catch (e) { console.warn(e); }
  }
  els.balance.value = state.balance;
  const paintBalance = () => els.balance.style.setProperty("--p", `${Math.round(state.balance * 100)}%`);
  paintBalance();
  els.balance.addEventListener("input", () => { state.balance = parseFloat(els.balance.value); store.set("mv.window.balance", String(state.balance)); paintBalance(); applyBalance(); });

  // ---------- transport ----------
  async function play() {
    state.want = true; ensureGraph(); document.body.classList.remove("armed");
    if (!state.track) setTrack(pick());
    mixRoom();
    try { await audio.play(); } catch (e) { if (e.name !== "AbortError") console.warn(e); }
  }
  function pause() { state.want = false; audio.pause(); mixRoom(); }
  function toggle() { state.want ? pause() : play(); }
  function nextRecord() { if (state.track) state.back = [...state.back, state.track].slice(-30); setTrack(pick()); if (state.want) play(); }
  function prevRecord() { if (audio.currentTime > 3 || !state.back.length) { audio.currentTime = 0; return; } setTrack(state.back.pop()); if (state.want) play(); }
  audio.addEventListener("play", () => { document.body.classList.add("playing"); renderLayers(); });
  audio.addEventListener("pause", () => { document.body.classList.remove("playing"); renderLayers(); });
  audio.addEventListener("ended", () => nextRecord());
  let fails = 0;
  audio.addEventListener("playing", () => { fails = 0; });
  audio.addEventListener("error", () => { if (++fails > 4) return; setTrack(pick()); if (state.want) play(); });
  els.play.addEventListener("click", toggle);
  els.next.addEventListener("click", nextRecord);
  els.prev.addEventListener("click", prevRecord);
  els.room.addEventListener("click", () => { if (!state.want) play(); });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("nexttrack", nextRecord);
    navigator.mediaSession.setActionHandler("previoustrack", prevRecord);
  }

  // ---------- chips and search ----------
  function chipTime(p) {
    // a rough local time for the chips, from longitude; the real offset arrives with the weather
    const d = new Date(Date.now() + Math.round(p.lon / 15) * 3600000);
    return `${pad(d.getUTCHours())}h`;
  }
  function renderChips() {
    const cur = state.place?.slug;
    const here = `<button class="wr-chip px" data-act="here" aria-pressed="${cur === "here"}">${ICON("map-pin")}Here</button>`;
    const list = PLACES.map((p) => `<button class="wr-chip px" data-slug="${p.slug}" aria-pressed="${cur === p.slug}">${esc(p.name)}</button>`).join("");
    const other = state.place && !PLACES.some((p) => p.slug === cur) && cur !== "here" ? `<button class="wr-chip px" aria-pressed="true">${esc(state.place.name)}</button>` : "";
    const find = `<button class="wr-chip px wr-find" data-act="find">${ICON("plus")}City</button>`;
    els.chips.innerHTML = here + other + list + find;
  }
  els.chips.addEventListener("click", (e) => {
    const b = e.target.closest(".wr-chip"); if (!b) return;
    if (b.dataset.act === "here") return goHere();
    if (b.dataset.act === "find") { els.search.classList.toggle("open"); els.q.focus(); return; }
    const p = PLACES.find((x) => x.slug === b.dataset.slug); if (p) setPlace(p);
  });
  els.search.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = els.q.value.trim(); if (!q) return;
    const p = await geocode(q).catch(() => null);
    if (!p) { toast(`Couldn't find "${q}"`); return; }
    els.q.value = ""; els.search.classList.remove("open"); setPlace(p);
  });
  function goHere() {
    if (!navigator.geolocation) { toast("This browser can't share its location"); return; }
    toast("Looking out of your window…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
      let name = "Your window";
      try { const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json(); name = j.city || j.locality || j.principalSubdivision || name; } catch {}
      setPlace({ slug: "here", name, lat, lon });
    }, () => toast("No location, so pick a city instead"), { timeout: 10000, maximumAge: 600000 });
  }

  // ---------- the scene ----------
  const art = WArt.create(els.scene);
  function fitScene() {
    const dpr = window.devicePixelRatio || 1, w = els.room.clientWidth;
    const k = Math.max(1, Math.floor(w * dpr / WArt.W));
    let cssW = k * WArt.W / dpr;
    if (cssW < w * .8) cssW = w;
    els.scene.style.width = `${cssW}px`; els.scene.style.height = `${cssW * WArt.H / WArt.W}px`;
    els.scene.style.setProperty("--pxu", `${k / dpr * 2}px`);
  }
  let last = performance.now(), lastSec = -1, lastMin = -1;
  function frame(now) {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const p = state.place;
    if (p) {
      const playing = !audio.paused;
      let lvl = 0;
      if (ctx && playing) { analyser.getByteTimeDomainData(tdata); let s = 0; for (let i = 0; i < tdata.length; i += 4) { const v = (tdata[i] - 128) / 128; s += v * v; } lvl = Math.sqrt(s / (tdata.length / 4)); }
      state.level += (clamp(lvl * 3) - state.level) * (lvl * 3 > state.level ? .5 : .12);
      const ms = Date.now(), h = localHour();
      art.render({
        dt, lat: p.lat, sun: WArt.sunPos(ms, p.lat, p.lon), moon: WArt.moonPos(ms, p.lat, p.lon), wx: state.wx,
        hour: h, cat: h >= 22 || h < 6, playing, level: state.level, freq: state.freq,
      });
      const d = localNow(), sec = d.getUTCSeconds();
      if (sec !== lastSec) {
        lastSec = sec; els.clock.textContent = `${pad(d.getUTCHours())}${sec % 2 ? " " : ":"}${pad(d.getUTCMinutes())}`;
        if (d.getUTCMinutes() !== lastMin) { lastMin = d.getUTCMinutes(); if (state.offset != null) { mixRoom(); pickMood(); } }
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- theme, keys, toast ----------
  function toggleTheme() {
    const light = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    store.set("mv.theme", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#FBF7F1" : "#202020");
  }
  els.theme.addEventListener("click", toggleTheme);
  if (document.documentElement.dataset.theme === "light") document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FBF7F1");
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.hidden = false; els.toast.classList.remove("leaving");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.classList.add("leaving"); setTimeout(() => (els.toast.hidden = true), 300); }, 2400);
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input[type=text], input[type=url], textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.code === "ArrowRight") nextRecord();
    else if (e.code === "ArrowLeft") prevRecord();
    else if (e.key === "t" || e.key === "T") toggleTheme();
  });

  // ---------- go: the hash, the last window, or a guess from the time zone ----------
  async function start() {
    fitScene(); addEventListener("resize", fitScene);
    document.body.classList.add("armed");
    requestAnimationFrame(frame);
    await loadCatalog();
    const want = decodeURIComponent(location.hash.slice(1));
    if (want === "here") { setPlace(PLACES[0], { quiet: true }); goHere(); return; }
    const preset = PLACES.find((p) => p.slug === want);
    if (preset) return setPlace(preset, { quiet: true });
    if (want) { const p = await geocode(want.replace(/-/g, " ")).catch(() => null); if (p) return setPlace(p, { quiet: true }); }
    try { const saved = JSON.parse(store.get("mv.window.place") || "null"); if (saved && saved.lat != null) return setPlace(saved, { quiet: true }); } catch {}
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " ");
    const guess = tz && !/^(UTC|GMT)/.test(tz) ? await geocode(tz).catch(() => null) : null;
    setPlace(guess || PLACES[0], { quiet: true });
  }
  start();
})();
