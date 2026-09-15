#!/usr/bin/env python3
"""Build data/catalog.json from Creative Commons albums on the Internet Archive.

Each category maps to a list of archive.org item identifiers. Run:
    python3 scripts/build-catalog.py
"""
import json, re, sys, urllib.request, urllib.parse, pathlib

MAX_PER_ITEM = 16

# YouTube 24/7 radios, the same sources the lofi radio sites use (Lofi Girl, Chillhop,
# STEEZYASFUCK, Nightride FM, ...). Live stream ids change when a channel restarts a
# stream, so run with --check to drop dead ones (needs yt-dlp) and replace them.
# (id, title, channel)
YT = {
    "coding": [
        ("rFZHOHl-L8A", "lofi hip hop radio · beats to relax/study to", "Lofi Girl"),
        ("7NOSDKb0HlU", "lofi hip hop radio · beats to study/relax to", "Chillhop Music"),
        ("blAFxjhg62k", "Coffee Shop Radio · chill lo-fi & jazzy beats", "STEEZYASFUCK"),
        ("jiua2V9q9V0", "Essentials Radio · chill beats", "Chillhop Music"),
        ("lP26UCnoH9s", "coffee shop radio · 24/7 lofi hip-hop beats", "STEEZYASFUCK"),
        ("4xDzrJKXOOY", "synthwave radio · beats to chill/game to", "Lofi Girl"),
        ("UjlMEqTu2KI", "Nightride FM · 24/7 synthwave radio", "Nightride FM"),
        ("YOF0AEY1G1U", "Hyperfocus Music 24/7 · deep work radio", "Hyperfocus Night Office"),
    ],
    "lofi": [
        ("JD-kMIpDfnY", "lofi hip hop radio · beats to sleep/chill to", "Lofi Girl"),
        ("1Tl2FtV06qo", "asian lofi radio · beats to relax/study to", "Lofi Girl"),
        ("0muHFBSiybw", "summer lofi radio · music to put you in a better mood", "Lofi Girl"),
        ("CwPCy1GLS38", "sad lofi radio · beats for rainy days", "Lofi Girl"),
        ("5yx6BWlEVcY", "Chillhop Radio · jazzy & lofi hip hop beats", "Chillhop Music"),
        ("i6WzngxTnBA", "late night vibes radio · calm lofi / dreamy beats", "Chillhop Music"),
        ("rPjez8z61rI", "lofi hip hop radio · beats to sleep/study/relax to", "STEEZYASFUCK"),
        ("OFsJen4j9VY", "Purrple Cat · lofi radio", "Purrple Cat"),
        ("vrB9wC6quaU", "Chill out lofi · rain on the rooftop", "Lofi on the Rooftop"),
        ("4Q9jq-tdOoE", "Peaceful Lofi Coffee in 90's Tokyo Street", "Lofi on the Rooftop"),
        ("1wckb-eWOxw", "jazz/lofi hip hop radio · chill beats to relax/study to", "lofi.cafe pick"),
        ("apCom1TeTiA", "24/7 lofi hip hop radio · beats to study/chill/relax", "lofi.cafe pick"),
        ("qH3fETPsqXU", "24/7 chill lofi hip hop radio", "lofi.cafe pick"),
    ],
    "focus": [
        ("N0snMcR6aaA", "relaxing piano radio · calm music to focus to", "Lofi Girl"),
        ("E2vONfzoyRI", "jazz lofi radio · beats to chill/study to", "Lofi Girl"),
        ("A8jDx9TLMQc", "relaxing jazz music · cozy radio to study/chill to", "Lofi Girl"),
        ("Dx5qFachd3A", "Relaxing Jazz Piano Radio · slow jazz 24/7", "Cafe Music BGM channel"),
        ("w9S5ID3nfOc", "Beautiful Piano Radio · relaxing music", "Soothing Relaxation"),
        ("RAK1ka_M98g", "Deep Focus Music 24/7 · rainy forest ambience", "FOCUS 365 studio"),
        ("tNkZsRW7h2c", "Space Ambient Music · 24/7", "lofi.cafe pick"),
        ("UedTcufyrHc", "ChillSynth FM · lofi synthwave for retro dreaming", "Nightride FM"),
    ],
    "sunset": [
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
    ],
}

# Audius: open API, free key (safe to ship client-side per Audius docs). Labels publish here
# officially; we keep only free-to-stream tracks. (user_id, label, allowed genres, max tracks)
AUDIUS_KEY = "0x075d48b8a8a4dd6c17211fd3211f1994cf1e15c6"
AUDIUS = {
    "coding": [
        ("eAE0q", "Chillhop Music", {"Lo-Fi", "Jazz"}, 140),
        ("D2P6Z", "College Music", {"Lo-Fi", "Hip-Hop/Rap"}, 60),
    ],
    "focus": [
        ("D2P6Z", "College Music", {"Ambient", "Jazz"}, 90),
        ("DNNg0", "Inner Ocean Records", {"Ambient", "Electronic"}, 19),
        ("n3YPZ", "Radio Juicy", {"Jazz", "Lo-Fi"}, 50),
    ],
}

def audius_tracks(user_id, label, genres, cap):
    """Free-to-stream tracks of an Audius user, most played first."""
    base = "https://api.audius.co/v1"
    out, offset = [], 0
    while offset < 1000:
        req = urllib.request.Request(f"{base}/users/{user_id}/tracks?api_key={AUDIUS_KEY}&limit=100&offset={offset}", headers={"User-Agent": "mystery-vinyl/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.load(r)["data"]
        if not page: break
        for t in page:
            ok = (t.get("access") or {}).get("stream") and not t.get("stream_conditions") and (t.get("duration") or 0) >= 60
            if ok and t.get("genre") in genres:
                art = t.get("artwork") or {}
                # label accounts title tracks "Artist - Title"; split so the artist shows properly
                title, artist = t["title"].strip(), t["user"]["name"]
                if " - " in title:
                    artist, title = [x.strip() for x in title.split(" - ", 1)]
                title = re.sub(r"\s*\[(remix contest|free download)[^\]]*\]\s*$", "", title, flags=re.I)
                out.append({
                    "id": f"audius/{t['id']}", "kind": "audio", "provider": "audius",
                    "title": title, "artist": artist, "album": label,
                    "duration": t["duration"], "plays": t.get("play_count") or 0,
                    "url": f"{base}/tracks/{t['id']}/stream?api_key={AUDIUS_KEY}&app_name=mysteryvinyl",
                    "cover": art.get("480x480") or art.get("150x150") or "",
                    "source": "https://audius.co" + t.get("permalink", f"/tracks/{t['id']}"),
                })
        offset += 100
    out.sort(key=lambda t: -t["plays"])
    for t in out: t.pop("plays", None)
    return out[:cap]

CATEGORIES = {
    "coding":  {"label": "Coding",  "tag": "beats to work to, 24/7 radios",        "youtube": YT["coding"]},
    "lofi":    {"label": "Lo-fi",   "tag": "the lofi radios everyone leaves on",    "youtube": YT["lofi"]},
    "focus":   {"label": "Focus",   "tag": "piano, jazz, ambient",                  "youtube": YT["focus"]},
    "sunset":  {"label": "Sunset",  "tag": "chill house, deep house, positive energy", "youtube": YT["sunset"]},
    # Creative Commons records from the Internet Archive: the only crate with real audio data
    # (waveform, crackle) and proper attribution.
    "records": {"label": "Records", "tag": "Creative Commons vinyl from the Internet Archive",
                "items": ["DWK031", "DWK155", "DWK127", "DWK217", "DWK149", "DWK312", "DWK044", "DWK163", "DWK123",
                          "CalmPills", "Vkrsnl037CandlegravityAMomentForMyself", "DWK119", "DWK138"]},
}

def check_live(entries):
    """With --check: ask yt-dlp which ids still play; drop the rest (prints what it dropped)."""
    import subprocess
    keep = []
    for vid, title, channel in entries:
        r = subprocess.run(["yt-dlp", "--ignore-config", "--no-warnings", "--skip-download",
                            "--print", "%(live_status)s|%(title)s", f"https://www.youtube.com/watch?v={vid}"],
                           capture_output=True, text=True)
        err = (r.stderr or "").lower()
        gone = any(k in err for k in ("video unavailable", "private video", "has been removed", "no longer available", "this video is not available", "account associated with this video has been terminated",
                                          "live stream recording is not available", "live event has ended"))
        if gone:
            print(f"  DROPPED {vid}  {title}")
        else:
            if r.returncode != 0: print(f"  kept (yt-dlp error, not a removal) {vid}  {title}")
            keep.append((vid, title, channel))
    return keep

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
    yt_entries = cat.get("youtube", [])
    if "--check" in sys.argv and yt_entries:
        yt_entries = check_live(yt_entries)
    for user_id, label, genres, cap in AUDIUS.get(key, []):
        got = audius_tracks(user_id, label, genres, cap)
        for t in got: t["category"] = key
        out["tracks"].extend(got)
        print(f"{key:10} audius {label:22} {len(got)} tracks")
    for vid, title, channel in yt_entries:
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
