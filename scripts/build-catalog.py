#!/usr/bin/env python3
"""Build data/catalog.json from Creative Commons albums on the Internet Archive.

Each category maps to a list of archive.org item identifiers. Run:
    python3 scripts/build-catalog.py
"""
import json, re, urllib.request, urllib.parse, pathlib

MAX_PER_ITEM = 16

CATEGORIES = {
    "coding": {"label": "Coding", "tag": "steady beats, swing, no vocals",
               "items": ["DWK031", "DWK155", "DWK127", "DWK217", "DWK149"]},
    "lofi":   {"label": "Lo-fi",  "tag": "dusty, warm, sampled",
               "items": ["DWK312", "DWK044", "DWK163", "DWK123"]},
    "focus":  {"label": "Focus",  "tag": "ambient and late-night jazz",
               "items": ["CalmPills", "Vkrsnl037CandlegravityAMomentForMyself", "DWK119", "ca200_cjazz", "DWK138"]},
    # Sunset is chill / deep house of the "Good Life Radio" kind. Nothing like it exists
    # under a free license, so this crate is YouTube 24/7 radios and long mixes, played
    # through the hidden player. (id, title, channel) — titles are just initial labels.
    "sunset": {"label": "Sunset", "tag": "chill house, deep house, positive energy", "youtube": [
        ("pRyS8QREMEs", "The Good Life Radio · 24/7 Live Radio", "Summerchillout"),
        ("UcrtmnGBUjM", "ChillYourMind Radio · 24/7 Chill House", "ChillYourMind"),
        ("8EuP8FKvNIY", "Morning Coffee · Chillout House 24/7", "Chilluxe"),
        ("sgEJ4sOwboM", "Summer Tropical & Deep House · 24/7", "We Are Diamond"),
        ("WsDyRAPFBC8", "Deep & Melodic House 24/7", "Monstercat Silk"),
        ("Ihm9OQWmibA", "Deep House · Smooth Background Music 24/7", "The Grand Sound"),
        ("m0eLLeGNuXk", "Gentleman Radio · Deep House, Chillout, Lounge", "Gentleman"),
        ("GjHIEdEAYqI", "Summer Deep House · Luxury Ocean Lounge 24/7", "Surfboard Deep Chillout"),
        ("m4rFr3YKUNI", "Morning Chillout · Smooth Deep House & Lounge Beats", "Chilluxe"),
        ("Ca5EtR-TAco", "Chill Deep House Mix · Relaxing Sunset Vibes", "Inner Deep Radio"),
        ("QhMs-t7EhXY", "Best Deep House Songs Of All Time · Deep House Vibes", "Inner Deep Radio"),
        ("ApWnwX1FPmY", "Best Tropical House Mix · Relaxing Summer Vibes", "TheHugProject"),
    ]},
}

def fetch(identifier):
    with urllib.request.urlopen(f"https://archive.org/metadata/{identifier}", timeout=60) as r:
        return json.load(r)

def clean_title(name, meta_title, artist):
    t = (meta_title or pathlib.Path(name).stem).replace("_", " ").strip()
    if artist and t.lower().startswith(artist.lower()):
        t = t[len(artist):].strip().lstrip("-").strip()
    t = re.sub(r"^\d{1,3}\s*[-_.)]\s*", "", t)               # leading track numbers
    t = re.sub(r"\s*\[\d{4}\]\s*$", "", t)                   # trailing [year]
    return t.strip() or pathlib.Path(name).stem

out = {"categories": [], "tracks": []}
for key, cat in CATEGORIES.items():
    out["categories"].append({"id": key, "label": cat["label"], "tag": cat["tag"]})
    for vid, title, channel in cat.get("youtube", []):
        out["tracks"].append({
            "id": f"yt/{vid}", "kind": "yt", "category": key, "videoId": vid,
            "title": title, "artist": channel, "album": "YouTube",
            "cover": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
            "covers": [f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg", f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"],
            "source": f"https://www.youtube.com/watch?v={vid}",
        })
    for ident in cat.get("items", []):
        d = fetch(ident)
        m = d["metadata"]
        album = re.sub(r"^\[[^\]]+\]\s*", "", m.get("title", ident))   # drop netlabel catalogue prefixes like "[rest037] "
        artist = m.get("creator") or ""
        if isinstance(artist, list): artist = artist[0]
        images = [f["name"] for f in d["files"] if f.get("format") in ("JPEG", "PNG") and f.get("source") == "original"]
        cover = next((n for n in images if re.search(r"front|folder", n, re.I)),
                next((n for n in images if re.search(r"cover|art", n, re.I) and not re.search(r"back|tray", n, re.I)), images[0] if images else "__ia_thumb.jpg"))
        seen = set()
        count = 0
        for f in sorted(d["files"], key=lambda f: 0 if f.get("format") == "VBR MP3" else 1):
            if not f["name"].lower().endswith(".mp3") or f.get("source") == "derivative" and f.get("format") != "VBR MP3":
                continue
            if f.get("format") not in ("VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3"):
                continue
            stem = re.sub(r"_(vbr|64kb|128kb)$", "", pathlib.Path(f["name"]).stem, flags=re.I)
            if stem in seen: continue
            seen.add(stem)
            length = f.get("length")
            try:
                secs = float(length) if ":" not in str(length) else sum(float(x) * 60 ** i for i, x in enumerate(reversed(str(length).split(":"))))
            except (TypeError, ValueError):
                secs = 0
            if secs < 60 or count >= MAX_PER_ITEM: continue
            count += 1
            track_artist = f.get("artist") or f.get("creator") or artist or "Unknown"
            out["tracks"].append({
                "id": f"{ident}/{f['name']}",
                "category": key,
                "title": clean_title(f["name"], f.get("title"), track_artist),
                "artist": track_artist,
                "album": album,
                "duration": round(secs),
                "url": f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
                "cover": f"https://archive.org/download/{ident}/{urllib.parse.quote(cover)}",
                "source": f"https://archive.org/details/{ident}",
                "license": m.get("licenseurl", ""),
            })
        print(f"{key:10} {ident:45} {album[:40]:40} tracks so far: {len(out['tracks'])}")

path = pathlib.Path(__file__).resolve().parent.parent / "data" / "catalog.json"
path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
print(f"wrote {path} with {len(out['tracks'])} tracks")
