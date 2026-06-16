# Criterion Closet Simulator

A walkable, interactive 3D recreation of the **[Criterion Closet](https://www.criterion.com/closet)** in a low-resolution PSX aesthetic. Browse ~1,700 films on shelves, click any tape to inspect its cover and metadata, and watch a 3D jewel case spin and float in the side panel.

Built with **Three.js** + **Vite**.

![screenshot placeholder](https://via.placeholder.com/800x400/1a1a1a/ffffff?text=Criterion+Closet+Simulator)

## Features

- **U-shaped room** — 10 bookcases, left/right/back walls, 9 shelves each
- **1,700+ films** — each with spine, cover, and full Criterion metadata
- **Seeded daily layout** — one layout per day (FNV-1a hash), persistable via localStorage
- **PSX aesthetic** — 320×240 render target, NearestFilter textures, flat lighting, fog
- **Tape interaction** — click any tape for a spinning 3D jewel case with cover art
- **Controls** — WASD move, mouse look, C to crouch, Shift to zoom, Q to toggle resolution
- **Leaning tapes** — some tapes lean slightly for that video-store look
- **Instanced jewel-case boxes** — 3 faces per tape (spine + cover + cover-back) with atlas texturing

## Controls

| Key | Action |
|---|---|
| Click | Lock pointer / click tape to inspect |
| WASD / Arrows | Move |
| Mouse | Look around |
| C (hold) | Crouch (slower, lower view) |
| Shift (hold) | Zoom (2×) |
| Q | Toggle PSX / full resolution |
| P | Toggle tuning panel (advanced) |

## Quick Start

```bash
cd src
npm install
npm run dev
```

Then open `http://localhost:5173/` and click to enter the closet.

To rebuild the asset data (spines, atlas, films JSON):

```bash
cd src
python3 preprocess/extract_spines.py
python3 preprocess/build_atlas.py
python3 preprocess/gen_films_json.py
```

## Project Structure

```
criterion-project/
├── src/
│   ├── index.html           # HTML shell, CSS, panel UI
│   ├── main.js              # Entry: renderer, controls, raycast, render loop
│   ├── closet.js            # Bookcase geometry, room walls, ceiling with fluorescent panels
│   ├── tapes.js             # Atlas loading, 3D jewel-case box geometry, tape placement
│   ├── layout.js            # Copy allocation, shelf packing, group gaps, leaning
│   ├── seed.js              # FNV-1a seeded PRNG for deterministic daily layouts
│   ├── history.js           # Seed history persistence
│   ├── panel3d.js           # 3D rotating jewel case in the side panel
│   ├── debug.js             # Tuning panel (P key toggle)
│   ├── animation.js         # (additional animation helpers)
│   ├── package.json
│   ├── vite.config.js
│   ├── public/
│   │   ├── assets/          # Precomputed: atlases, films.json, covers, spines, carpet texture
│   │   └── fonts/           # VCR OSD Mono font
│   └── preprocess/          # Python scripts for asset generation
└── (film directories)       # Source data — not needed to run
```

## Data Notes

The precomputed assets (`src/public/assets/`) are ~65MB and include:
- **4 atlas sheets** (2048×2048) — packed spine strips
- **films.json** — full metadata + atlas UV references
- **Covers** — 256px-wide cover images

**The repo includes `metadata.json`** in the project root (~1MB). This contains all ~1,700 films with titles, years, spine numbers, directors, countries, and `cover_url` links to large cover images on criterion.com's CDN.

To regenerate the assets from scratch:

```bash
# Prerequisites: Python 3 + Pillow + numpy
cd src
python3 preprocess/extract_spines.py    # Reads cover images from local film directories
python3 preprocess/build_atlas.py       # Packs spine strips into atlas sheets
python3 preprocess/gen_films_json.py    # Generates films.json from metadata + atlas UVs
```

The pipeline expects film cover images at `criterion-project/{film-folder}/cover.jpg` where film-folders are sanitized titles (e.g., `12 Angry Men/cover.jpg`). These cover images are **not included in the repo** — they must be downloaded separately. The `cover_url` field in `metadata.json` provides the source URLs on the Criterion CDN.

A download helper is not part of this repo, but the URL format is: `https://criterion-production.s3.amazonaws.com/{path_from_metadata}`. A simple `wget` or `curl` script can fetch them all.

**If you can't run the full pipeline**, the prebuilt assets (`films.json`, atlases, covers, spines) are available for download — check the [Releases](https://github.com/YOUR_USERNAME/criterion-closet/releases) tab.

## Credits

- Film data and artwork © The Criterion Collection
- VCR OSD Mono font by [æ](https://deadchest.com/)
- Carpet texture and ceiling light diffuser from stock sources