#!/usr/bin/env python3
"""Phase 0.3 v3: Generate films.json — match by position (same order as extract)."""
import json, re
from pathlib import Path

METADATA_PATH = Path(__file__).parent.parent.parent / "metadata.json"
ATLAS_MANIFEST = Path(__file__).parent.parent / "public" / "assets" / "atlas_manifest.json"
SPINE_MANIFEST = Path(__file__).parent.parent / "public" / "assets" / "spine_manifest.json"
OUT_PATH = Path(__file__).parent.parent / "public" / "assets" / "films.json"

def make_film_id(title, year, spine):
    """Must match extract_spines.py's make_film_id exactly."""
    safe = title.lower().strip()
    safe = safe.replace("'", "").replace("&", "and")
    safe = re.sub(r'[^a-z0-9]+', '-', safe)
    safe = safe.strip('-')
    year_str = str(year) if year else "0000"
    base = f"{safe}-{year_str}"
    if spine and str(spine).isdigit():
        return f"{base}-sp{spine}"
    return base

def main():
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    
    with open(ATLAS_MANIFEST, "r") as f:
        atlas = json.load(f)
    
    with open(SPINE_MANIFEST, "r") as f:
        spines = json.load(f)
    
    # Build lookup: id -> spine manifest entry
    spine_by_id = {s["id"]: s for s in spines}
    
    # Build lookup: film_id -> atlas entry
    # Also track (title, year, spine) -> film_id from spine manifest for dedup
    spine_key_to_id = {}
    for s in spines:
        key = (s["title"], str(s.get("year", "")), str(s.get("spine", "")))
        spine_key_to_id[key] = s["id"]
    
    films = []
    no_atlas = 0
    for film in metadata:
        title = film.get("title", "").strip()
        if not title or film.get("is_boxset"):
            continue
        
        year = film.get("year", "")
        spine = film.get("spine", "")
        
        # Generate the same ID extract_spines.py would
        film_id = make_film_id(title, year, spine)
        
        # Fallback: try spine manifest lookup by key
        if film_id not in atlas:
            key = (title, str(year), str(spine))
            alt_id = spine_key_to_id.get(key)
            if alt_id and alt_id in atlas:
                film_id = alt_id
        
        atlas_ref = atlas.get(film_id)
        if not atlas_ref:
            no_atlas += 1
            continue
        
        films.append({
            "id": film_id,
            "spine": int(spine) if spine and str(spine).isdigit() else None,
            "title": title,
            "year": int(year) if year and str(year).isdigit() else None,
            "director": film.get("director"),
            "country": film.get("country"),
            "isBoxset": False,
            "syntheticSpine": spine_by_id.get(film_id, {}).get("syntheticSpine", False),
            "cover": f"covers/{film_id}.jpg",
            "atlasRef": atlas_ref,
        })
    
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(films, f, indent=2)
    
    with_ref = sum(1 for f in films if f.get("atlasRef"))
    print(f"Generated {len(films)} films -> {OUT_PATH}")
    print(f"With atlas ref: {with_ref}/{len(films)}")
    print(f"Without atlas ref: {no_atlas} (no atlas match)")

if __name__ == "__main__":
    main()