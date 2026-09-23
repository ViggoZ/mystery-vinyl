/* Immersive: the pixel room fills the page instead of sitting in a box beside it.
   - Sizes the art buffer to the screen at a whole number of device pixels per art pixel, so pixels stay square.
   - Wide screens: the room covers the viewport, its 200x160 scene sits on the right, the text lives on the wall to the left.
   - Narrow screens: the room runs edge to edge across the top, and the page below takes the colour of the room's floor.
   - Every few frames it looks at what's behind the header, the text and the dock, and flips each to light or dark ink. */
window.Immersive = (canvas, art, { anchor = "center", onInk } = {}) => {
  const body = document.body, room = document.querySelector(".tm-room"), info = document.querySelector(".tm-info"), dock = document.querySelector(".tm-dock");
  const sleeve = document.querySelector(".sleeve"), nav = document.querySelector(".topnav");
  let k = 1, BW = 200, BH = 160, OX = 0, OY = 0, wide = false, n = 0;

  function fit() {
    const vw = document.documentElement.clientWidth, vh = innerHeight, dpr = window.devicePixelRatio || 1;
    wide = vw > 860 && vw / vh > 1.05;
    body.classList.toggle("im-wide", wide);
    if (wide) {
      k = Math.max(1, Math.min(Math.floor(vw * dpr / 300), Math.floor(vh * dpr / 172)));
      BW = Math.ceil(vw * dpr / k); BH = Math.ceil(vh * dpr / k);
      const dockArt = Math.ceil((dock ? dock.offsetHeight : 100) * dpr / k);
      OX = BW - 200 - Math.round(BW * .05);
      OY = anchor === "floor"
        ? Math.min(Math.round((BH - 160) / 2), BH - dockArt - 142)     // keep the floor line clear of the dock
        : Math.max(0, Math.round((BH - dockArt - 160) / 2));
      body.style.setProperty("--free", `${OX * k / dpr}px`);            // how much wall there is left of the scene
      room.style.height = "";
    } else {
      k = Math.floor(vw * dpr / 200);
      if (k < 2) k = vw * dpr / 205;                                     // a low-density narrow screen: fill it, pixels a hair uneven
      BW = Math.ceil(vw * dpr / k);
      const band = parseFloat(getComputedStyle(body).getPropertyValue("--band")) || 72;
      OY = Math.ceil(band * dpr / k); OX = Math.floor((BW - 200) / 2); BH = OY + 162;
    }
    art.resize(BW, BH, OX, OY);
    const cw = BW * k / dpr, ch = BH * k / dpr;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    if (!wide) { const band = parseFloat(getComputedStyle(body).getPropertyValue("--band")) || 72; room.style.height = `${Math.max(0, ch - band)}px`; }
    n = 0; tick(true);
  }

  const lum = ([r, g, b]) => (.2126 * r + .7152 * g + .0722 * b) / 255;
  const avg = (pts) => { let r = 0, g = 0, b = 0; for (const [x, y] of pts) { const c = art.sample(Math.round(x), Math.round(y)); r += c[0]; g += c[1]; b += c[2]; } return [r / pts.length, g / pts.length, b / pts.length]; };
  function ink(el, c) {
    if (!el) return false;
    const dark = lum(c) > .56, was = el.classList.contains("ink-dark");
    el.classList.toggle("ink-dark", dark); el.classList.toggle("ink-light", !dark);
    const fresh = !el.dataset.inked; el.dataset.inked = "1";
    return fresh || was !== dark;
  }
  function tick(force) {
    if (!force && ++n % 12 && n > 3) return;                               // every frame at first, then every 12th
    const bottom = avg([[BW * .15, BH - 2], [BW * .5, BH - 2], [BW * .85, BH - 2], [BW * .3, BH - 5]]);
    body.style.setProperty("--scene-bg", `rgb(${bottom.map((v) => Math.round(v)).join(" ")})`);
    let changed = false;
    changed = ink(sleeve, avg([[3, 3], [BW * .12, 6], [BW * .06, 10]])) || changed;
    changed = ink(nav, avg([[BW - 3, 3], [BW * .88, 6], [BW * .94, 10]])) || changed;
    changed = ink(dock, wide ? avg([[BW * .1, BH - 8], [BW * .5, BH - 8], [BW * .9, BH - 8], [BW * .3, BH - 3]]) : bottom) || changed;
    const wall = wide ? avg(Array.from({ length: 12 }, (_, i) => [6 + (OX - 12) * (i % 4) / 3, BH * (.25 + .18 * Math.floor(i / 4))])) : bottom;
    changed = ink(info, wall) || changed;
    if (changed && onInk) onInk();
  }

  fit();
  addEventListener("resize", fit);
  return { fit, tick };
};
