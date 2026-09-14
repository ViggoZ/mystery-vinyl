# Mystery Vinyl

Open the page, a record drops, music plays. Pick a mood (Coding, Lo-fi, Focus, Thinking, Designing) and the deck pulls a random record from that crate. The turntable on the right is drawn entirely with CSS + SVG: the platter spins up and coasts down with real inertia, the tonearm swings in, drops, and tracks inward as the song plays, and the record is swapped when you skip.

## Run it

Static files only, but the catalog is fetched with `fetch()`, so serve it over HTTP:

```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Keyboard: `space` play / pause, `→` next record, `←` restart / previous.

## Where the music comes from

All tracks are Creative Commons albums hosted on the Internet Archive (mostly the Dusted Wax Kingdom netlabel, plus a few ambient/jazz releases). The archive serves MP3s with CORS headers, so the browser can stream them directly and run them through the Web Audio analyser for the waveform. Each track shows its album, license and a link back to the source, which is what CC BY / BY-NC licenses ask for.

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
