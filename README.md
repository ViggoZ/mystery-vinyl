# Mystery Vinyl

Open the page, a record drops, music plays. Pick a mood (Coding, Lo-fi, Focus, Sunset) and the deck pulls a random record from that crate. The turntable on the right is drawn entirely with CSS + SVG: the platter spins up and coasts down with real inertia, the tonearm swings in, drops, and tracks inward as the song plays, and the record is swapped when you skip.

## Run it

Static files only, but the catalog is fetched with `fetch()`, so serve it over HTTP:

```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Keyboard: `space` play / pause, `→` next record, `←` restart / previous, `F` full screen, `T` light / dark theme, `N` vinyl crackle on / off.

The surface noise is synthesized with Web Audio (a filtered pink-noise loop plus randomly spaced pops), so there are no sample files. It fades in when the needle drops and out when it lifts, and the needle drop itself has a small thump.

Pausing lifts the tonearm back onto its rest; resuming swings it back to the groove you left. Full screen hides everything except the deck, the waveform and the title, and the controls fade out after a few seconds without mouse movement.

## Your own music

The `+` chip at the end of the mood row opens your crate. Paste a link and it becomes a "Yours" mood:

- a YouTube video, playlist or live link (played through a hidden IFrame player, so no waveform, and a few videos that forbid embedding will be skipped)
- an `archive.org/details/…` album (full support: waveform, crackle, attribution)
- a direct mp3 / m4a / stream URL (Icecast radio streams work too)

Sources are kept in localStorage only. Note for local development: YouTube refuses to play inside embeds served from `127.0.0.1` / `localhost` (error 150), so test the YouTube path on a real domain.

## Where the music comes from

Sunset is the exception: that "positive chill / deep house" sound has no free-licensed equivalent, so the crate is a curated list of YouTube 24/7 radios and long mixes, played through the same hidden player as your own links. Edit the `youtube` list in `scripts/build-catalog.py` to swap them.

All other tracks are Creative Commons albums hosted on the Internet Archive (mostly the Dusted Wax Kingdom netlabel, plus a few ambient/jazz releases). The archive serves MP3s with CORS headers, so the browser can stream them directly and run them through the Web Audio analyser for the waveform. Each track shows its album, license and a link back to the source, which is what CC BY / BY-NC licenses ask for.

`data/catalog.json` is generated, not hand-written:

```sh
python3 scripts/build-catalog.py
```

Edit the `CATEGORIES` map in that script to add or swap archive.org items per mood. Anything with an `mp3` derivative and a `licenseurl` works.

## Files

- `index.html` — markup, logo and the tonearm SVG
- `styles.css` — layout, the plinth / platter / record / sheen, responsive rules
- `app.js` — queue + transport, platter physics, tonearm geometry, waveform, autoplay gate
- `scripts/build-catalog.py` — pulls metadata from archive.org into `data/catalog.json`

## License

Code is MIT. The music is not part of this repository: every track streams from the Internet Archive under its own Creative Commons license (mostly CC BY-NC-ND), shown next to the player. If you fork this for anything commercial, swap the catalog for music you have the rights to.
