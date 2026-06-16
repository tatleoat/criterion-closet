#!/usr/bin/env python3
"""Phase 0.1: Downscale covers, extract spine strips, detect synthetic spines."""
import json, os, sys, re
from pathlib import Path
from io import BytesIO

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system("uv pip install Pillow")
    from PIL import Image

import numpy as np

ROOT = Path(__file__).parent.parent.parent
COVERS_DIR = ROOT  # covers are in criterion-project/{film}/cover.jpg
METADATA_PATH = ROOT / "metadata.json"
OUT_COVERS = Path(__file__).parent.parent / "public" / "assets" / "covers"
OUT_SPINES = Path(__file__).parent.parent / "public" / "assets" / "spines"
OUT_MANIFEST = Path(__file__).parent.parent / "public" / "assets" / "spine_manifest.json"

COVER_WIDTH = 256
SPINE_WIDTH = COVER_WIDTH // 10  # 25px

def sanitize(title):
    safe = title.replace("/", " & ").replace("\\", " & ")
    safe = safe.replace(":", " -").replace("*", "").replace("?", "")
    safe = safe.replace('"', "").replace("<", "").replace(">", "").replace("|", "")
    safe = safe.strip().strip(".")
    return safe[:120] if len(safe) > 120 else safe

def make_film_id(title, year, spine):
    """Generate a stable unique ID from title + year + optional spine number."""
    safe = title.lower().strip()
    safe = safe.replace("'", "").replace("&", "and")
    safe = re.sub(r'[^a-z0-9]+', '-', safe)
    safe = safe.strip('-')
    year_str = str(year) if year else "0000"
    base = f"{safe}-{year_str}"
    # Append spine number if available to disambiguate
    if spine and str(spine).isdigit():
        return f"{base}-sp{spine}"
    return base

def color_diff(c1, c2):
    """Simple Euclidean distance in RGB space."""
    return np.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

def detect_synthetic_spine(img):
    """Check if left 10% is just the cover edge (no distinct spine art)."""
    w, h = img.size
    spine_strip = img.crop((0, 0, SPINE_WIDTH, h))
    cover_edge = img.crop((SPINE_WIDTH, 0, SPINE_WIDTH * 2, h))
    
    # Average color of each strip
    spine_arr = np.array(spine_strip, dtype=np.float64)
    edge_arr = np.array(cover_edge, dtype=np.float64)
    
    spine_avg = spine_arr.mean(axis=(0, 1))
    edge_avg = edge_arr.mean(axis=(0, 1))
    
    # Also check variance of spine strip — a flat color means no art
    spine_var = spine_arr.std(axis=(0, 1)).mean()
    
    diff = color_diff(spine_avg, edge_avg)
    
    # If spine is near-identical to neighboring cover edge AND low variance
    if diff < 15 and spine_var < 30:
        return True, tuple(spine_avg.astype(int))
    return False, None

def main():
    OUT_COVERS.mkdir(parents=True, exist_ok=True)
    OUT_SPINES.mkdir(parents=True, exist_ok=True)
    
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        films = json.load(f)
    
    films = [f for f in films if not f.get("is_boxset")]
    print(f"Processing {len(films)} individual films...")
    
    manifest = []
    processed = 0
    no_cover = 0
    
    for i, film in enumerate(films):
        title = film.get("title", "").strip()
        year = film.get("year")
        if year is not None:
            year = str(year).strip()
        else:
            year = "0000"
        folder = sanitize(title)
        cover_path = ROOT / folder / "cover.jpg"
        
        if not cover_path.exists():
            no_cover += 1
            continue
        
        try:
            img = Image.open(cover_path).convert("RGB")
        except Exception as e:
            print(f"  SKIP {title}: {e}")
            no_cover += 1
            continue
        
        # Resize to 256px wide
        w, h = img.size
        new_h = int(h * COVER_WIDTH / w)
        img = img.resize((COVER_WIDTH, new_h), Image.LANCZOS)
        
        # Generate stable ID from title+year+spine
        film_id = make_film_id(title, year, film.get("spine"))
        out_cover = OUT_COVERS / f"{film_id}.jpg"
        img.save(out_cover, "JPEG", quality=85)
        
        # Extract spine strip (left 10%)
        spine_img = img.crop((0, 0, SPINE_WIDTH, new_h))
        out_spine = OUT_SPINES / f"{film_id}.jpg"
        spine_img.save(out_spine, "JPEG", quality=85)
        
        # Detect synthetic
        is_synthetic, dominant_color = detect_synthetic_spine(img)
        
        manifest.append({
            "id": film_id,
            "spine": film.get("spine"),
            "title": title,
            "year": year,
            "coverPath": f"covers/{film_id}.jpg",
            "spinePath": f"spines/{film_id}.jpg",
            "coverW": COVER_WIDTH,
            "coverH": new_h,
            "spineW": SPINE_WIDTH,
            "spineH": new_h,
            "syntheticSpine": is_synthetic,
            "dominantColor": [int(c) for c in dominant_color] if dominant_color else None,
        })
        
        processed += 1
        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{len(films)}...")
    
    # Save manifest
    with open(OUT_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\nDone! Processed: {processed}, No cover: {no_cover}")
    print(f"Covers → {OUT_COVERS}")
    print(f"Spines → {OUT_SPINES}")
    print(f"Manifest: {OUT_MANIFEST}")

if __name__ == "__main__":
    main()
