# Criterion Closet Simulator — Handoff

## What It Is

A walkable, interactive **PSX-era 3D** recreation of the Criterion Closet. ~1,700 Criterion films rendered as jewel-case tapes on 10 U-shaped bookcases. Click any tape to see its cover and metadata. Built with **Three.js** + **Vite**.

**Running it:**
```bash
cd criterion-project/src
npx vite --host 0.0.0.0 --port 5195
```
Visit `http://192.168.50.44:5195/`. Vite auto-reloads on file changes.

---

## Closet Layout — 10 Bookcases in a U

| Wall | X | Z positions | rotY |
|---|---|---|---|
| Left (4 cases) | -1.40 | -3.75, -1.50, 0.75, 3.00 | -π/2 |
| Right (4 cases) | 3.30 | -3.75, -1.50, 0.75, 3.00 | π/2 |
| Back (2 cases) | -0.175, 2.075 | 4.35 | π |

Each case: 2.1m wide × **2.5m tall** × 0.3m deep, **9 shelves**, 60 slots per shelf = **5,400 capacity**.

---

## Current Hardcoded Values (Final)

These are the parameters the simulator is currently running with. Source of truth is `tapes.js` and `closet.js`.

| Parameter | Value | File |
|---|---|---|
| Case height (`CASE_H`) | **2.5** | closet.js |
| Ceiling Y | **2.7** | closet.js |
| Shelf spacing | **0.25** (CASE_H / 10) | closet.js |
| Shelf gap (tape calc) | **0.30** (spacing + 0.05) | tapes.js |
| Tape height multiplier | **0.66** of shelfGap | tapes.js |
| Tape height (actual) | **0.198** | tapes.js |
| Tape Y offset | **-0.22** (from shelf top + halfH) | tapes.js |
| Tape inset from case | **0.15** | tapes.js CASES array |
| Tape width ratio | **0.616** × SLOT_W | tapes.js |
| Tape thickness | **0.04** | tapes.js |
| Slot jitter (anti-moiré) | **±0.01** | layout.js |
| Group gap | **0.4** slot-widths | layout.js |
| Fill target | **90%** (~4860 tapes) | layout.js |

---

## Key Source Files

| File | Lines | Purpose |
|---|---|---|
| `src/main.js` | ~350 | Entry: renderer, camera, pointerlock controls, floor, raycast click/hover, render loop |
| `src/tapes.js` | ~240 | Atlas loading, film manifest, 3D jewel-case box geometry, tape building |
| `src/closet.js` | ~130 | Bookcase 3D geometry, ceiling grid with diffuser lights |
| `src/layout.js` | ~125 | Copy allocation (weighted PRNG), shelf packing, group gaps, leaning, slot jitter |
| `src/seed.js` | ~40 | FNV-1a date hash → seeded PRNG. One layout per day |
| `src/history.js` | ~45 | Past seeds persisted in localStorage |
| `src/debug.js` | ~210 | Tuning panel (P key) — number inputs for live tweaking + Report button |
| `src/panel3d.js` | ~90 | Rotating/bobbing jewel case when clicking a tape |
| `src/animation.js` | ~40 | Helper animation functions |
| `src/preprocess/*.py` | — | Asset generation pipeline |

---

## Tape Rendering

### Geometry
Each tape is a **3-face box** (merged meshes per atlas sheet):

1. **Spine face** — narrow edge facing the aisle (front +Z face), textured from atlas UVs
2. **Cover face** — large side at +X (right side of case)
3. **Cover back face** — large side at -X (left side of case)

Shell faces (cover + cover back) are textured from the rightmost 5% of the same atlas strip → solid-color look.

### Texture loading
- 4 atlas sheets of 2048×2048, loaded with `flipY=false`, `NearestFilter`
- Atlas manifest maps film ID → {sheet, uv}

### Raycast click resolution
Each merged mesh stores `tapeIds[]` and `trisPerTape`. Click divides `faceIndex / trisPerTape` to find the film. `trisPerTape` = 2 for spine (1 quad), 4 for shell (2 quads). Both types are in separate merged meshes per atlas sheet.

### Leaning
Some tapes at group boundaries tilt slightly — the `leaning` flag (set in layout.js) applies a vertex transform that shears the top of the tape forward and sideways. About 0-3 leaning tapes per shelf, only at group ends.

---

## Texture / Material Conventions

| Element | Source | Filtering | Notes |
|---|---|---|---|
| Tape spines | Atlas sheets (atlas_{0-3}.png) | Nearest | Packed spine strips |
| Tape shell (cover) | Rightmost 5% of atlas strip | Nearest | Solid-color look |
| Floor | `assets/carpet.jpg` | Nearest | Downscaled 256×256, edge-blended for seamless tiling, noise overlaid |
| Ceiling lights | `assets/light_diffuser.webp` | Nearest | MeshBasicMaterial, DoubleSide |
| Wall planes | Solid color (#080808) | — | Behind bookcases |
| Bookcases | Solid color (#2a2a2a, #333, #1a1a1a) | — | Case, shelf, back respectively |

---

## Data Pipeline

All precomputed assets live in `src/public/assets/`.

| Asset | Generator | Purpose |
|---|---|---|
| `covers/{id}.jpg` | `extract_spines.py` | 256px-wide cover images |
| `spines/{id}.jpg` | `extract_spines.py` | Left 10% spine strips |
| `spine_manifest.json` | `extract_spines.py` | Maps film → spine image dimensions |
| `atlas_{0-3}.png` | `build_atlas.py` | Packed spine strips in 2048×2048 atlas sheets |
| `atlas_manifest.json` | `build_atlas.py` | Maps film ID → {sheet, uv} in atlas |
| `films.json` | `gen_films_json.py` | Full film metadata + atlasRef |

**Film IDs** are `{slugified-title}-{year}-sp{spine}` (e.g. `2-or-3-things-i-know-about-her-1967-sp482`).

### Regeneration
```bash
cd criterion-project/src
python3 preprocess/extract_spines.py
python3 preprocess/build_atlas.py
python3 preprocess/gen_films_json.py
```

Requires cover images on disk (sourced via `metadata.json` which contains cover URLs — users fetch their own).

---

## Controls

| Key | Action |
|---|---|
| Click (canvas) | Lock pointer |
| WASD / Arrows | Walk (AABB collision with bookcases) |
| Click (locked) | Raycast center → open side panel with film metadata |
| Hover (locked) | Black caption bar shows film title |
| **Q** | Toggle PSX 320×240 / full resolution |
| **P** | Toggle tuning panel (number inputs, report, rebuild) |
| **Shift** (hold) | 2x zoom |

---

## PSX Aesthetic

- 320×240 render target with NearestFilter → blit to canvas
- NearestFilter on all textures
- Flat/ambient lighting (AmbientLight 0.65 + DirectionalLight 0.25)
- Fog at range 8-25
- Floor texture: 256×256 canvas, NearestFilter, edge-blended for seamless tiling, grain noise overlaid

---

## Seed System

`seed.js` — FNV-1a hash of YYYY-MM-DD → seeded PRNG (`mulberry32`). One unique layout per day. History persisted in localStorage via `history.js`.

---

## GitHub

**Repo:** `https://github.com/tatleoat/criterion-closet`

**What's tracked:**
- All source code
- `metadata.json` (film data + cover URLs for user self-fetching)
- `carpet.jpg`, `light_diffuser.webp` (placeholder textures)
- README, LICENSE, package.json, fonts

**What's NOT tracked (user regenerates):**
- Atlas sheets, films.json, spine_manifest.json
- Cover / spine images

---

## Tuning Panel

Press **P** in the browser to open a live tuning overlay with number inputs for:

- Tape Height Multiplier, Tape Y Offset, Tape Inset
- Tape Width Ratio, Tape Thickness
- Case Height, Shelf Gap Extra
- Slot Jitter, Group Gap Min/Max, Fill Target

**"Rebuild Now"** removes and re-creates all tape meshes with current values. **"Report Values"** prints a handoff-ready config summary to console + a copyable textarea.

The tuning config lives on `window.__C` and is read at build time by `tapes.js` and `layout.js`. Fallback defaults in the source files match the final hardcoded values above.

---

## Common Gotchas

1. **HMR listener leaks** — `window.__mouseMoveCount` tracks mousemove listeners to catch HMR leaks.
2. **Panel 3D flickering** — solved by making planes slightly smaller than edges and using `polygonOffset`.
3. **Moiré on shelves** — fixed with per-tape slot jitter (±0.01, seeded per day).
4. **Module-level constants** — `CASE_H`, `TAPE_W`, `TAPE_THICKNESS` in `tapes.js` are getter functions that read from `window.__C` with fallback defaults, NOT plain values. The tuning panel can override them.
5. **Rebuild requirements** — `__rebuildTapes` is on `window`, reads current `window.__C`, re-packs shelves, and rebuilds tape meshes. Does NOT rebuild closet or ceiling geometry.

---

## Environment

- `.env.local` in project root stores `VITE_YOUTUBE_API_KEY` for YouTube Data API v3
- `.gitignore` excludes `.env.local`
- Vite auto-loads `.env.local` — use `import.meta.env.VITE_YOUTUBE_API_KEY` in code