"""
One-time data pipeline for the Palworld Breeding Route Planner.

Downloads game-derived data from tylercamp/palcalc (MIT licensed, generated
directly from the game's asset tables), scrapes element types and Pal icons
from paldb.cc, and emits compact static files under data/ and assets/pals/.

This script is a build-time tool only. The website itself never contacts
any third party at runtime -- everything here is checked into the repo.

Usage:
    py tools/build_data.py            # full run (fetch + scrape + icons)
    py tools/build_data.py --no-icons # skip icon downloads (fast iteration)
    py tools/build_data.py --no-elements  # skip element scrape (fast iteration)

Requires only the Python 3 standard library.
"""

import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
ICONS_DIR = os.path.join(ROOT, "assets", "pals")
CACHE_DIR = os.path.join(ROOT, "tools", "cache")

DB_URL = "https://raw.githubusercontent.com/tylercamp/palcalc/main/PalCalc.Model/db.json"
BREEDING_URL = "https://raw.githubusercontent.com/tylercamp/palcalc/main/PalCalc.Model/breeding.json"
PALDB_PAGE_FMT = "https://paldb.cc/en/{name}"
ICON_URL_FMT = "https://cdn.paldb.cc/image/Pal/Texture/PalIcon/Normal/T_{internal}_icon_normal.webp"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PalworldBreedingSitePlanner/1.0 (personal fan tool)"


def http_get(url, retries=3, pause=0.5):
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return None
        except Exception as e:
            last_err = e
        time.sleep(pause * (attempt + 1))
    print(f"  WARNING: failed to fetch {url}: {last_err}", file=sys.stderr)
    return None


def cached_fetch(url, cache_name):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    data = http_get(url)
    if data is not None:
        with open(path, "wb") as f:
            f.write(data)
    return data


def load_upstream():
    print("Fetching db.json (pals, passives, breeding mechanics)...")
    db_raw = cached_fetch(DB_URL, "db.json")
    if db_raw is None:
        print("FATAL: could not fetch db.json", file=sys.stderr)
        sys.exit(1)
    db = json.loads(db_raw)

    print("Fetching breeding.json (exhaustive pair table, ~8.6MB)...")
    breeding_raw = cached_fetch(BREEDING_URL, "breeding.json")
    if breeding_raw is None:
        print("FATAL: could not fetch breeding.json", file=sys.stderr)
        sys.exit(1)
    breeding = json.loads(breeding_raw)

    return db, breeding


ELEMENT_KEY_RE = re.compile(
    r"<div>ElementType(\d)</div>\s*<div>([A-Za-z]+)</div>", re.IGNORECASE
)


def scrape_element(internal_name, display_name):
    """Scrape ElementType1/2 rows from a paldb.cc Pal page. Returns list of element names."""
    page_name = display_name.replace(" ", "_")
    url = PALDB_PAGE_FMT.format(name=urllib.parse.quote(page_name))
    html = http_get(url, retries=2, pause=0.6)
    if html is None:
        return None
    text = html.decode("utf-8", errors="ignore")
    found = {}
    for m in ELEMENT_KEY_RE.finditer(text):
        found[int(m.group(1))] = m.group(2)
    if not found:
        return None
    return [found[k] for k in sorted(found)]


def build_pals_json(db, elements_cache):
    pals = db["Pals"]
    gender_probs = db["BreedingGenderProbability"]
    out = []
    # Stable ordering: sort by InternalIndex to match how breeding.json / db.json
    # were generated, then re-number 0..N-1 -- this order is what breeding.bin uses.
    ordered = sorted(pals, key=lambda p: p["InternalIndex"])
    for i, p in enumerate(ordered):
        internal = p["InternalName"]
        gp = gender_probs.get(internal, {"MALE": 0.5, "FEMALE": 0.5})
        out.append({
            "i": i,
            "internalName": internal,
            "name": p["Name"],
            "dex": p["Id"]["PalDexNo"],
            "isVariant": p["Id"]["IsVariant"],
            "breedingPower": p["BreedingPower"],
            "rarity": p["Rarity"],
            "elements": elements_cache.get(internal, []),
            "maleProb": round(gp.get("MALE", 0.5), 4),
        })
    return out


def build_passives_json(db):
    out = []
    for p in db["PassiveSkills"]:
        if not p.get("IsStandardPassiveSkill"):
            continue
        out.append({
            "internalName": p["InternalName"],
            "name": p["Name"],
            "rank": p["Rank"],
            "description": p.get("Description"),
            "randomAllowed": bool(p.get("RandomInheritanceAllowed")),
            "randomWeight": p.get("RandomInheritanceWeight", 0),
        })
    # stable order: rank descending (best first), then name
    out.sort(key=lambda p: (-p["rank"], p["name"]))
    return out


def build_breeding_bin(pals_json, breeding):
    name_to_idx = {p["internalName"]: p["i"] for p in pals_json}
    n = len(pals_json)
    size = n * (n + 1) // 2

    def pair_index(a, b):
        if a > b:
            a, b = b, a
        return a * n - (a * (a - 1)) // 2 + (b - a)

    UNSET = 0xFFFF
    table = [UNSET] * size
    gender_specific = []

    for e in breeding["Breeding"]:
        p1, p2, child = e["Parent1InternalName"], e["Parent2InternalName"], e["ChildInternalName"]
        if p1 not in name_to_idx or p2 not in name_to_idx or child not in name_to_idx:
            continue
        g1, g2 = e["Parent1Gender"], e["Parent2Gender"]
        ci = name_to_idx[child]
        if g1 == "WILDCARD" and g2 == "WILDCARD":
            table[pair_index(name_to_idx[p1], name_to_idx[p2])] = ci
        else:
            # Gender-specific override (e.g. CatMage/FoxMage). Keep the
            # WILDCARD-derived table entry as a fallback and record the
            # specific rule separately for exact lookups.
            gender_specific.append({
                "p1": name_to_idx[p1], "g1": g1,
                "p2": name_to_idx[p2], "g2": g2,
                "child": ci,
            })

    unset_count = sum(1 for v in table if v == UNSET)
    if unset_count:
        print(f"  WARNING: {unset_count} pair(s) have no child mapping", file=sys.stderr)

    raw = struct.pack(f"<{size}H", *table)
    return raw, gender_specific, n


def download_icons(pals_json, skip=False):
    os.makedirs(ICONS_DIR, exist_ok=True)
    if skip:
        print("Skipping icon download (--no-icons).")
        return
    print(f"Downloading {len(pals_json)} Pal icons (paced to avoid CDN rate-limits)...")
    ok = 0
    for idx, p in enumerate(pals_json):
        internal = p["internalName"]
        dest = os.path.join(ICONS_DIR, f"{internal}.webp")
        if os.path.exists(dest):
            ok += 1
            continue
        url = ICON_URL_FMT.format(internal=internal)
        data = http_get(url, retries=3, pause=0.6)
        if data:
            with open(dest, "wb") as f:
                f.write(data)
            ok += 1
        else:
            print(f"  missing icon: {internal}", file=sys.stderr)
        time.sleep(0.35)
        if (idx + 1) % 25 == 0:
            print(f"  {idx + 1}/{len(pals_json)}...")
    print(f"Icons: {ok}/{len(pals_json)} present.")


def scrape_all_elements(pals_json, skip=False):
    cache_path = os.path.join(CACHE_DIR, "elements.json")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
    if skip:
        print("Skipping element scrape (--no-elements); using cache only.")
        return cache
    print(f"Scraping element types from paldb.cc for {len(pals_json)} Pals...")
    changed = False
    for idx, p in enumerate(pals_json):
        internal = p["internalName"]
        if internal in cache:
            continue
        els = scrape_element(internal, p["name"])
        if els:
            cache[internal] = els
            changed = True
        else:
            print(f"  no element found for {internal} ({p['name']})", file=sys.stderr)
        time.sleep(0.5)
        if (idx + 1) % 25 == 0:
            print(f"  {idx + 1}/{len(pals_json)}...")
            if changed:
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=1)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    return cache


def main():
    no_icons = "--no-icons" in sys.argv
    no_elements = "--no-elements" in sys.argv

    db, breeding = load_upstream()
    print(f"  {len(db['Pals'])} Pals, {len(db['PassiveSkills'])} passive skill entries in db.json")
    print(f"  {len(breeding['Breeding'])} breeding table rows")

    # elements need names first; build a name-only pass, then scrape, then rebuild with elements.
    prelim_pals = build_pals_json(db, elements_cache={})
    elements_cache = scrape_all_elements(prelim_pals, skip=no_elements)
    pals_json = build_pals_json(db, elements_cache)

    passives_json = build_passives_json(db)

    breeding_bin, gender_specific, n = build_breeding_bin(pals_json, breeding)

    mech = db["BreedingMechanics"]

    os.makedirs(DATA_DIR, exist_ok=True)

    with open(os.path.join(DATA_DIR, "pals.json"), "w", encoding="utf-8") as f:
        json.dump(pals_json, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(DATA_DIR, "passives.json"), "w", encoding="utf-8") as f:
        json.dump(passives_json, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(DATA_DIR, "breeding.bin"), "wb") as f:
        f.write(breeding_bin)

    meta = {
        "speciesCount": n,
        "passiveInheritanceWeights": mech["PassiveInheritanceWeights"],
        "passiveRandomWeights": mech["PassiveRandomWeights"],
        "genderSpecificRules": gender_specific,
        "sourceVersion": db.get("Version"),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(DATA_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    download_icons(pals_json, skip=no_icons)

    print()
    print("=== Summary ===")
    print(f"  data/pals.json       : {len(pals_json)} pals")
    print(f"  data/passives.json   : {len(passives_json)} standard passives")
    print(f"  data/breeding.bin    : {len(breeding_bin)} bytes ({len(breeding_bin)/1024:.1f} KB)")
    print(f"  data/meta.json       : gender-specific rules = {len(gender_specific)}")
    n_icons = len([f for f in os.listdir(ICONS_DIR) if f.endswith(".webp")]) if os.path.isdir(ICONS_DIR) else 0
    print(f"  assets/pals/*.webp   : {n_icons} icons on disk")
    n_elements = len(elements_cache)
    print(f"  elements scraped     : {n_elements}/{len(pals_json)}")


if __name__ == "__main__":
    main()
