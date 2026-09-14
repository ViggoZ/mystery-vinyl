#!/usr/bin/env python3
"""Build data/catalog.json from Creative Commons albums on the Internet Archive.

Each category maps to a list of archive.org item identifiers. Run:
    python3 scripts/build-catalog.py
"""
import json, re, urllib.request, urllib.parse, pathlib

MAX_PER_ITEM = 16

CATEGORIES = {
    "coding":    {"label": "Coding",    "tag": "steady beats, no vocals", "items": ["DWK031", "DWK155", "DWK127"]},
    "lofi":      {"label": "Lo-fi",     "tag": "dusty, warm, hiss",       "items": ["DWK312", "DWK044", "DWK163"]},
    "focus":     {"label": "Focus",     "tag": "ambient, slow, wide",     "items": ["CalmPills", "Vkrsnl037CandlegravityAMomentForMyself"]},
    "thinking":  {"label": "Thinking",  "tag": "jazz, late night",        "items": ["DWK119", "ca200_cjazz", "DWK138"]},
    "designing": {"label": "Designing", "tag": "swing, sampled, playful", "items": ["DWK123", "DWK217", "DWK149"]},
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
    for ident in cat["items"]:
        d = fetch(ident)
        m = d["metadata"]
        album = m.get("title", ident)
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
