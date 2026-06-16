#!/usr/bin/env python3
"""Phase 0.2 v2: Pack spine strips into atlas sheets — handle any height."""
import json
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    import os; os.system("uv pip install Pillow"); from PIL import Image

MANIFEST_PATH = Path(__file__).parent.parent / "public" / "assets" / "spine_manifest.json"
OUT_ATLAS_DIR = Path(__file__).parent.parent / "public" / "assets"
OUT_MANIFEST_PATH = Path(__file__).parent.parent / "public" / "assets" / "atlas_manifest.json"

ATLAS_SIZE = 2048
PADDING = 2

def pack_rects(spines, width, height):
    """Greedy row packing. Same-width spines stacked by height."""
    items = [(s["spineW"], s["spineH"], s["id"]) for s in spines]
    items.sort(key=lambda x: -x[1])  # Sort by height descending for efficient packing
    
    sheets = []
    sheet_rects = []
    
    x, y, row_h = 0, 0, 0
    
    for sw, sh, film_id in items:
        if x + sw + PADDING > width:
            x = 0
            y += row_h + PADDING
            row_h = 0
        
        if y + sh + PADDING > height:
            sheets.append(sheet_rects)
            sheet_rects = []
            x, y, row_h = 0, 0, 0
        
        sheet_rects.append((len(sheets), x, y, sw, sh, film_id))
        x += sw + PADDING
        row_h = max(row_h, sh)
    
    if sheet_rects:
        sheets.append(sheet_rects)
    
    return sheets

def main():
    OUT_ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(MANIFEST_PATH, "r") as f:
        spine_data = json.load(f)
    
    print(f"Packing {len(spine_data)} spines...")
    
    sheets = pack_rects(spine_data, ATLAS_SIZE, ATLAS_SIZE)
    print(f"Packed into {len(sheets)} atlas sheets")
    
    atlas_manifest = {}
    
    for sheet_idx, rects in enumerate(sheets):
        atlas = Image.new("RGB", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0))
        
        for _, x, y, w, h, film_id in rects:
            spine_path = Path(__file__).parent.parent / "public" / "assets" / "spines" / f"{film_id}.jpg"
            if spine_path.exists():
                spine_img = Image.open(spine_path).convert("RGB")
                atlas.paste(spine_img, (x, y))
                
                u0 = x / ATLAS_SIZE
                v0 = y / ATLAS_SIZE
                u1 = (x + w) / ATLAS_SIZE
                v1 = (y + h) / ATLAS_SIZE
                
                atlas_manifest[film_id] = {
                    "sheet": sheet_idx,
                    "uv": [round(u0, 6), round(v0, 6), round(u1, 6), round(v1, 6)],
                }
        
        out_path = OUT_ATLAS_DIR / f"atlas_{sheet_idx}.png"
        atlas.save(out_path, "PNG")
        print(f"  Sheet {sheet_idx}: {len(rects)} spines → {out_path}")
    
    with open(OUT_MANIFEST_PATH, "w") as f:
        json.dump(atlas_manifest, f, indent=2)
    
    print(f"\nAtlas manifest: {OUT_MANIFEST_PATH}")
    print(f"Total packed spines: {len(atlas_manifest)}")

if __name__ == "__main__":
    main()