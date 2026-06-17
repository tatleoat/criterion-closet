import * as THREE from 'three';

let atlasTextures = [];
let films = [];
let filmMap = {};
let loaded = false;

export async function loadAtlases() {
  const loader = new THREE.TextureLoader();
  atlasTextures = [];
  for (let i = 0; i < 4; i++) {
    try {
      const tex = await new Promise((res, rej) =>
        loader.load(`/assets/atlas_${i}.png`, res, undefined, () => rej(new Error(`atlas ${i}`)))
      );
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      atlasTextures.push(tex);
    } catch { atlasTextures.push(null); }
  }
}

// ─── Color cache for films (computed from atlas) ─────────
let filmColorsCache = null;
const ATLAS_SIZE = 2048;
const TILE_SIZE = 128;

/**
 * For each film that has an atlasRef, compute the average color of its cover
 * in OKLCH hue order (red→orange→yellow→green→cyan→blue→purple→magenta→red),
 * with black/white/grey sorted by luminance at the end.
 * Returns: { filmId -> { hue, saturation, lightness, hex } }
 */
export async function computeFilmColors(films) {
  if (filmColorsCache) return filmColorsCache;

  const colorData = {};
  const needsCompute = films.filter(f => f.atlasRef);
  if (needsCompute.length === 0) return colorData;

  // Load atlas sheets as ImageElements (for canvas extraction)
  const sheetImages = [];
  for (let i = 0; i < 4; i++) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `/assets/atlas_${i}.png`;
    });
    sheetImages.push(img);
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = TILE_SIZE;
  tempCanvas.height = TILE_SIZE;
  const tempCtx = tempCanvas.getContext('2d');
  const tempData = tempCtx.createImageData(TILE_SIZE, TILE_SIZE);
  const tempBuf = new Uint32Array(tempData.data.buffer);

  for (const film of needsCompute) {
    const ref = film.atlasRef;
    const sheetIdx = ref.sheet;
    const img = sheetImages[sheetIdx];
    if (!img) continue;

    // UV: [uMin, vMin, uMax, vMax] in 0-1 normalized
    const uMin = ref.uv[0], vMin = ref.uv[1], uMax = ref.uv[2], vMax = ref.uv[3];
    const px = Math.round(uMin * ATLAS_SIZE);
    const py = Math.round(vMin * ATLAS_SIZE);
    const pw = Math.round((uMax - uMin) * ATLAS_SIZE);
    const ph = Math.round((vMax - vMin) * ATLAS_SIZE);

    if (pw <= 0 || ph <= 0) continue;

    // Draw the film's region from the atlas into temp canvas
    tempCtx.drawImage(img, px, py, pw, ph, 0, 0, TILE_SIZE, TILE_SIZE);
    const pixels = tempCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;

    // Average RGB
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const pr = pixels[i], pg = pixels[i+1], pb = pixels[i+2];
      if (pr === 0 && pg === 0 && pb === 0) continue; // skip pitch-black borders
      r += pr; g += pg; b += pb;
      count++;
    }
    if (count === 0) continue;
    r = r / count | 0;
    g = g / count | 0;
    b = b / count | 0;

    // RGB → HSL
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const L = (max + min) / 2;
    let H = 0, S = 0;

    if (max !== min) {
      const d = max - min;
      S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case R: H = ((G - B) / d + (G < B ? 6 : 0)) / 6; break;
        case G: H = ((B - R) / d + 2) / 6; break;
        case B: H = ((R - G) / d + 4) / 6; break;
      }
    }

    // Sort key: low saturation (grey) → sort by luminance at end
    // Articles (red→yellow) first, then greens, blues, purples, then black→white
    let sortVal;
    if (S < 0.1) {
      // Grey/black/white — sort by luminance, 2.0 + normalized luminance
      sortVal = 10 + L; // 10.0 to 11.0
    } else if (L < 0.15) {
      // Very dark colors — append after grey
      sortVal = 11 + H;
    } else if (L > 0.85) {
      // Very light colors — append after dark
      sortVal = 12 + H;
    } else {
      // Normal chromatic colors: 0-1 by hue
      sortVal = H;
    }

    colorData[film.id] = {
      hue: H,
      saturation: S,
      lightness: L,
      sortVal,
      hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    };
  }

  filmColorsCache = colorData;
  return colorData;
}

export function getColorForFilm(filmId) {
  return filmColorsCache?.[filmId] || null;
}

export async function loadFilms() {
  const resp = await fetch('/assets/films.json');
  films = await resp.json();
  filmMap = Object.fromEntries(films.map(f => [f.id, f]));
  loaded = true;
}

export function getFilm(id) { return filmMap[id] || null; }
export function getFilms() { return films; }

// Read tuning config from window.__C, with hardcoded defaults
function tune(key, fallback) {
  return (window.__C && window.__C[key] !== undefined) ? window.__C[key] : fallback;
}

const CASE_W = 2.1;
const CASE_H = () => tune('caseHeight', 2.5);
const SHELF_COUNT = 9;
const SLOT_W = CASE_W / 60;
const TAPE_W = () => SLOT_W * tune('tapeWidthRatio', 0.5);
const TAPE_THICKNESS = () => tune('tapeThickness', 0.1);

function rotateLocalXZ(x, z, rotY) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [x * c - z * s, x * s + z * c];
}

// 3-face jewel-case box: spine(front), back, top
function buildBoxVerts(halfW, halfH, halfD) {
  const fbl = [-halfW, -halfH,  halfD], fbr = [ halfW, -halfH,  halfD];
  const ftr = [ halfW,  halfH,  halfD], ftl = [-halfW,  halfH,  halfD];
  const bbl = [-halfW, -halfH, -halfD], bbr = [ halfW, -halfH, -halfD];
  const btr = [ halfW,  halfH, -halfD], btl = [-halfW,  halfH, -halfD];
  // 5 quads: spine (+Z, textured), cover (+X, textured), coverBack (-X, textured),
  //          back (-Z, shell), top (+Y, shell)
  const spine = [fbl, fbr, ftr, ftl];
  const cover = [fbr, ftr, btr, bbr];
  const coverBack = [bbl, btl, ftl, fbl];
  const back = [bbr, bbl, btl, btr];
  const top = [ftl, ftr, btr, btl];
  const sp = [], sh = [];
  for (const v of spine) sp.push(v[0], v[1], v[2]);
  for (const v of cover) sp.push(v[0], v[1], v[2]);
  for (const v of coverBack) sp.push(v[0], v[1], v[2]);
  for (const v of back) sh.push(v[0], v[1], v[2]);
  for (const v of top) sh.push(v[0], v[1], v[2]);
  return { spineVerts: 12, shellVerts: 8, spinePos: sp, shellPos: sh };
}

export function buildTapes(layout, scene) {
  if (!loaded) throw new Error('Assets not loaded');

  const tapes = layout.tapes;
  const bySheet = [[], [], [], []];
  const cfg = window.__C || {};

  // Compute dynamic face values from case positions + inset
  const inset = cfg.tapeInset !== undefined ? cfg.tapeInset : 0.15;
  const CASES = [
    { cx: -1.40, cz: -3.75, axis: 'z', faceX:  -1.40 + inset, rotY: -Math.PI / 2 },
    { cx: -1.40, cz: -1.50, axis: 'z', faceX:  -1.40 + inset, rotY: -Math.PI / 2 },
    { cx: -1.40, cz: 0.75,  axis: 'z', faceX:  -1.40 + inset, rotY: -Math.PI / 2 },
    { cx: -1.40, cz: 3.00,  axis: 'z', faceX:  -1.40 + inset, rotY: -Math.PI / 2 },
    { cx: 3.30,  cz: -3.75, axis: 'z', faceX:  3.30 - inset, rotY:  Math.PI / 2 },
    { cx: 3.30,  cz: -1.50, axis: 'z', faceX:  3.30 - inset, rotY:  Math.PI / 2 },
    { cx: 3.30,  cz: 0.75,  axis: 'z', faceX:  3.30 - inset, rotY:  Math.PI / 2 },
    { cx: 3.30,  cz: 3.00,  axis: 'z', faceX:  3.30 - inset, rotY:  Math.PI / 2 },
    { cx: -0.175, cz: 4.35, axis: 'x', faceZ:  4.35 - inset, rotY: Math.PI },
    { cx: 2.075, cz: 4.35, axis: 'x', faceZ:  4.35 - inset, rotY: Math.PI },
  ];

  for (const tape of tapes) {
    const film = filmMap[tape.filmId];
    if (!film?.atlasRef) continue;
    const sheet = film.atlasRef.sheet;
    if (sheet < 4 && atlasTextures[sheet]) bySheet[sheet].push({ tape, uv: film.atlasRef.uv });
  }

  const total = bySheet.reduce((s, g) => s + g.length, 0);
  log(`Building ${total} jewel-case boxes...`);

  const allSpineMeshes = [];
  const allShellMeshes = [];

  for (let sheetIdx = 0; sheetIdx < 4; sheetIdx++) {
    const group = bySheet[sheetIdx];
    if (group.length === 0 || !atlasTextures[sheetIdx]) continue;

    const sheetTex = atlasTextures[sheetIdx];
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, side: THREE.DoubleSide });
    const spineMat = new THREE.MeshStandardMaterial({ map: sheetTex, roughness: 0.5, side: THREE.DoubleSide });

    for (let batch = 0; batch < Math.ceil(group.length / 500); batch++) {
      const slice = group.slice(batch * 500, (batch + 1) * 500);
      const count = slice.length;
      if (!count) continue;

      const spinePos = [], spineUv = [], spineIdx = [];
      const shellPos = [], shellUv = [], shellIdx = [];
      const tapeIds = [];

      let spineVertOff = 0, shellVertOff = 0;

      for (let i = 0; i < count; i++) {
        const { tape, uv } = slice[i];
        tapeIds.push(tape.filmId);
        const c = CASES[tape.caseIndex];
        if (!c) continue;

        const ch = CASE_H();
        const tw = TAPE_W();
        const tt = TAPE_THICKNESS();
        const cfg = window.__C || {};
        const shelfSpacing = ch / 10;
        const shelfGap = shelfSpacing + (cfg.shelfGapExtra !== undefined ? cfg.shelfGapExtra : 0.05);
        const shelfLocalY = -ch / 2 + (tape.shelfInCase + 1) * shelfSpacing;
        const shelfWorldY = ch / 2 + shelfLocalY;
        const tapeHeight = shelfGap * (cfg.tapeHeightMul !== undefined ? cfg.tapeHeightMul : 0.66);
        const halfH = tapeHeight / 2;
        const centerY = shelfWorldY + halfH + (cfg.tapeYOffset !== undefined ? cfg.tapeYOffset : -0.22);
        const halfW = (tw * tape.width) / 2;
        const halfD = tt / 2;

        let centerX, centerZ;
        if (c.axis === 'z') {
          centerX = c.faceX;
          centerZ = c.cz - CASE_W / 2 + (tape.slotIndex + 1.5) * SLOT_W + (tape.slotJitter || 0) + (tw * tape.width) / 2;
        } else {
          centerX = c.cx - CASE_W / 2 + (tape.slotIndex + 1.5) * SLOT_W + (tape.slotJitter || 0) + (tw * tape.width) / 2;
          centerZ = c.faceZ;
        }

        const bv = buildBoxVerts(halfW, halfH, halfD);

        // Apply lean if this tape is marked as leaning
        // Tilt the top of the tape slightly forward (toward the aisle) and to the right
        const leanSlide = tape.leaning ? tt * 0.15 : 0;

        // Adjust vertices for leaning: top vertices shift out and sideways
        function applyLean(lx, ly, lz) {
          if (!tape.leaning) return [lx, ly, lz];
          // Ly > 0 means top half — tilt forward (+Z in local space) and slide right (+X)
          const t = Math.max(0, ly / halfH); // 0 at middle, 1 at top
          return [lx + leanSlide * t, ly, lz + tt * 0.3 * t];
        }

        // Spine verts
        for (let j = 0; j < bv.spineVerts; j++) {
          let lx = bv.spinePos[j*3], ly = bv.spinePos[j*3+1], lz = bv.spinePos[j*3+2];
          [lx, ly, lz] = applyLean(lx, ly, lz);
          const [rx, rz] = rotateLocalXZ(lx, lz, c.rotY);
          spinePos.push(centerX + rx, centerY + ly, centerZ + rz);
        }
        // Shell verts
        for (let j = 0; j < bv.shellVerts; j++) {
          let lx = bv.shellPos[j*3], ly = bv.shellPos[j*3+1], lz = bv.shellPos[j*3+2];
          [lx, ly, lz] = applyLean(lx, ly, lz);
          const [rx, rz] = rotateLocalXZ(lx, lz, c.rotY);
          shellPos.push(centerX + rx, centerY + ly, centerZ + rz);
        }

        // Spine UV — 3 quads: spine strip (cropped), cover (full strip), coverBack (full strip)
        const uR = uv[0] + (uv[2] - uv[0]) * 0.70;
        const vB = uv[3], vT = uv[1];
        // Quad 1: spine face — cropped right edge to avoid cover bleed
        spineUv.push(uv[0], vB, uR, vB, uR, vT, uv[0], vT);
        // Quad 2: cover face — full strip stretched across large face
        spineUv.push(uv[0], vB, uv[2], vB, uv[2], vT, uv[0], vT);
        // Quad 3: coverBack face — same as cover
        spineUv.push(uv[0], vB, uv[2], vB, uv[2], vT, uv[0], vT);

        // Shell UV — dark grey, no texture needed (shellMat has solid color)
        for (let j = 0; j < bv.shellVerts; j++) {
          shellUv.push(0, 0);
        }

        // Spine indices (3 quads = 6 tris)
        spineIdx.push(spineVertOff, spineVertOff+1, spineVertOff+2, spineVertOff, spineVertOff+2, spineVertOff+3);
        spineIdx.push(spineVertOff+4, spineVertOff+5, spineVertOff+6, spineVertOff+4, spineVertOff+6, spineVertOff+7);
        spineIdx.push(spineVertOff+8, spineVertOff+9, spineVertOff+10, spineVertOff+8, spineVertOff+10, spineVertOff+11);
        spineVertOff += bv.spineVerts;

        // Shell indices (2 quads)
        shellIdx.push(shellVertOff, shellVertOff+1, shellVertOff+2, shellVertOff, shellVertOff+2, shellVertOff+3);
        shellIdx.push(shellVertOff+4, shellVertOff+5, shellVertOff+6, shellVertOff+4, shellVertOff+6, shellVertOff+7);
        shellVertOff += bv.shellVerts;
      }

      // Spine mesh
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spinePos), 3));
      sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(spineUv), 2));
      sg.setIndex(new THREE.BufferAttribute(new Uint32Array(spineIdx), 1));
      sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, spineMat);
      sm.userData.tapeIds = tapeIds;
      sm.userData.trisPerTape = 6;
      allSpineMeshes.push(sm);

      // Shell mesh
      if (shellPos.length > 0) {
        const shg = new THREE.BufferGeometry();
        shg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shellPos), 3));
        shg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(shellUv), 2));
        shg.setIndex(new THREE.BufferAttribute(new Uint32Array(shellIdx), 1));
        shg.computeVertexNormals();
        const shm = new THREE.Mesh(shg, shellMat);
        shm.userData.tapeIds = tapeIds;
        shm.userData.trisPerTape = 4;
        allShellMeshes.push(shm);
      }
    }
  }

  const wrapper = new THREE.Group();
  allSpineMeshes.forEach(m => wrapper.add(m));
  allShellMeshes.forEach(m => wrapper.add(m));
  scene.add(wrapper);
  log(`${total} jewel-case boxes rendered`);
  return { mesh: wrapper, count: total };
}

function log(msg) {
  const el = document.getElementById('info');
  if (el) el.textContent = msg;
  console.log(msg);
}