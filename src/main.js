import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { buildCloset, buildCeiling } from './closet.js';
import { generateSeed, getTodayDate } from './seed.js';
import { allocateCopies, packShelves } from './layout.js';
import { recordLayout, loadHistory } from './history.js';
import { loadAtlases, loadFilms, getFilm, getFilms, buildTapes } from './tapes.js';
import { showFilm3D, closePanel3D, initPanel3D } from './panel3d.js';
import { initPicks, addPick, isPicked, renderPicks, applyQualityToPicks } from './picks.js';
import { computeFilmColors } from './tapes.js';
import { placeMoviePosters, rebuildPosters } from './posters.js';
import { ensureAssets } from './data_check.js';
import './debug.js'; // P key toggles tuning panel

// ─── Renderer ────────────────────────────────────────────
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);

// PSX low-res render target
const RT_W = 320, RT_H = 240;
const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});
const fullScreen = new THREE.Scene();
const fullCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshBasicMaterial({ map: rt.texture, depthTest: false, depthWrite: false })
);
fullScreen.add(fsQuad);

// ─── CSS3D Renderer (for YouTube trailer projection) ─────
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.top = '0';
cssRenderer.domElement.style.pointerEvents = 'none';
cssRenderer.domElement.style.zIndex = '1';
document.body.appendChild(cssRenderer.domElement);

// Projector screen — a hidden iframe on the back wall, shown when a trailer is requested
let projectorObject = null;
let projectorActive = false;

function showProjector(videoId) {
  if (projectorObject) {
    scene.remove(projectorObject);
    projectorObject = null;
  }

  const origin = window.location.origin; // e.g. http://192.168.50.44:5195
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
  iframe.style.width = '640px';
  iframe.style.height = '360px';
  iframe.style.border = 'none';
  iframe.style.pointerEvents = 'auto';
  iframe.style.background = '#000';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.id = 'youtube-player';

  // Listen for YouTube IFrame API state changes via postMessage
  window.__onYouTubeIframeAPIReady = null;
  function onYouTubeMsg(e) {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : null;
      if (data && data.event === 'onStateChange') {
        // YouTube states: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
        if (data.info === 0) {
          hideProjector();
        }
      }
    } catch {}
  }
  window.__ytMsgHandler = onYouTubeMsg;
  window.addEventListener('message', onYouTubeMsg);

  projectorObject = new CSS3DObject(iframe);
  const wallH = 2.5 + 0.2; // from closet.js wallH
  // Front/entrance wall (-Z wall the camera faces) at Z=-10.00, center X=0.95
  projectorObject.position.set(0.95, wallH / 2, -9.98);
  // Scale: 640 → ~4.5 scene units wide (wall is 6 wide)
  projectorObject.scale.set(-0.007, 0.007, 0.007); // negative X = horizontal mirror
  projectorObject.rotation.y = Math.PI; // face -Z (toward camera)
  scene.add(projectorObject);
  projectorActive = true;
  ambientLight.intensity = 0.05;
  sun.intensity = 0.02;

  // Store original ceiling colors and dim
  if (!window.__ceilingOrigColors) {
    window.__ceilingOrigColors = [];
    ceiling.traverse(child => {
      if (child.isMesh && child.material && child.material.color) {
        window.__ceilingOrigColors.push({ mesh: child, hex: child.material.color.getHex() });
      }
    });
  }
  for (const entry of window.__ceilingOrigColors) {
    entry.mesh.material.color.setHex(0x222222);
    entry.mesh.material.needsUpdate = true;
  }
  // Darken floor
  if (!window.__floorOrigHex) window.__floorOrigHex = floorMat.color.getHex();
  floorMat.color.setHex(0x222222);

  // Store poster original colors and dim
  if (!window.__posterOrigColors && window.__posterMats) {
    window.__posterOrigColors = window.__posterMats.map(m => ({ mat: m, hex: m.color.getHex() }));
  }
  if (window.__posterMats) {
    for (const mat of window.__posterMats) {
      mat.color.setHex(0x222222);
      mat.needsUpdate = true;
    }
  }

  // ─── Polling fallback ────────────────────────────────────
  // YouTube's postMessage may not fire reliably (HTTP origin, related video autoplay, etc.).
  // Poll the iframe's currentTime every 2s and auto-restore when the video's ended.
  // Also set a hard safety timeout of 10 minutes so lights never stay dim forever.
  if (window.__projectorPoll) clearInterval(window.__projectorPoll);
  if (window.__projectorTimeout) clearTimeout(window.__projectorTimeout);

  window.__projectorStartTime = Date.now();
  window.__projectorVideoId = videoId;

  window.__projectorPoll = setInterval(() => {
    if (!projectorActive) {
      clearInterval(window.__projectorPoll);
      window.__projectorPoll = null;
      return;
    }
    try {
      const player = document.getElementById('youtube-player');
      if (player && player.contentWindow) {
        // Post a message asking for current time — YouTube's JS API won't reply
        // to arbitrary polling, so instead: check if enough time has passed
        // since start. A typical trailer is 1–3 min; we watch for 3× the video duration
        // or a hard cap, whichever comes first.
        // The reliable path: detect via the iframe's own ended state (postMessage).
        // The fallback: if postMessage never fires, auto-restore after the video
        // length (estimated via duration API failed too), capped at 10 min.

        // Best-effort: try to read the iframe's duration/currentTime via postMessage
        // YouTube won't respond to raw postMessage — need the YT IFrame API.
        // Fallback: after 10 minutes of no activity, force-restore.
        // But we can do better: check if the iframe src still points to the same video
        // and the elapsed time exceeds a reasonable trailer duration.
        const elapsed = (Date.now() - window.__projectorStartTime) / 1000;
        // Cap at 10 minutes absolute.
        if (elapsed > 600) {
          hideProjector();
          return;
        }
      }
    } catch {}
  }, 2000);

  window.__projectorTimeout = setTimeout(() => {
    if (projectorActive) hideProjector();
  }, 600000); // 10 minute absolute safety net

  log('🎬 Trailer playing on back wall');
}

function hideProjector() {
  if (projectorObject) {
    scene.remove(projectorObject);
    projectorObject = null;
  }
  projectorActive = false;
  ambientLight.intensity = window.__origAmbientIntensity;
  sun.intensity = window.__origSunIntensity;
  // Restore ceiling
  if (window.__ceilingOrigColors) {
    for (const entry of window.__ceilingOrigColors) {
      entry.mesh.material.color.setHex(entry.hex);
      entry.mesh.material.needsUpdate = true;
    }
  }
  // Restore floor
  if (window.__floorOrigHex) {
    floorMat.color.setHex(window.__floorOrigHex);
  }
  // Restore posters
  if (window.__posterOrigColors) {
    for (const entry of window.__posterOrigColors) {
      entry.mat.color.setHex(entry.hex);
      entry.mat.needsUpdate = true;
    }
  }
  if (window.__ytMsgHandler) {
    window.removeEventListener('message', window.__ytMsgHandler);
    window.__ytMsgHandler = null;
  }
  // Clear polling fallback and safety timeout
  if (window.__projectorPoll) {
    clearInterval(window.__projectorPoll);
    window.__projectorPoll = null;
  }
  if (window.__projectorTimeout) {
    clearTimeout(window.__projectorTimeout);
    window.__projectorTimeout = null;
  }
}

// ─── Scene ────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.fog = new THREE.Fog(0x1a1a1a, 8, 25);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 30);
camera.position.set(0.95, 1.6, -8.5);
camera.rotation.set(0, Math.PI, 0); // face -Z toward the entrance

// ─── Controls ─────────────────────────────────────────────
const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 1.0;

// Track controls instances for debugging
window.__controlsCount = (window.__controlsCount || 0) + 1;
console.log('[DEBUG] Controls created: instance #' + window.__controlsCount);

// HMR guard: properly disconnect old listeners on hot reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    controls.disconnect();
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#panel')) return;
  controls.lock();
});
controls.addEventListener('lock', () => document.getElementById('info').style.display = 'none');
controls.addEventListener('unlock', () => document.getElementById('info').style.display = 'block');

// ─── Lighting ─────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xffffff, 0.25);
sun.position.set(0, 8, 5);
scene.add(sun);
// Store original light intensities for restoring after dimming
window.__origAmbientIntensity = 1.2;
window.__origSunIntensity = 0.25;

// ─── State ─────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => keys[e.code] = true);
document.addEventListener('keyup', e => keys[e.code] = false);
// Q key toggles between PSX low-res and full resolution
let hires = false;
// Crouching toggle
let crouching = false;

// Wipe pause flag — set during melt wipe so the animate loop doesn't overwrite the wipe canvas
let wipePaused = false;
window.__hires = hires;
window.__lightsOn = true;
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ' && document.pointerLockElement) {
    hires = !hires;
    window.__hires = hires;
    if (hires) {
      rt.setSize(window.innerWidth, window.innerHeight);
      log(`🔓 Q — full res (${window.innerWidth}×${window.innerHeight})`);
    } else {
      rt.setSize(RT_W, RT_H);
      log(`🔒 Q — PSX res (${RT_W}×${RT_H})`);
    }
    // Re-render picks at matching quality
    applyQualityToPicks();
  }
  // C key toggles crouch
  if (e.code === 'KeyC') {
    crouching = !crouching;
  }
  // M key toggles sort menu
  if (e.code === 'KeyM') {
    const menu = document.getElementById('sort-menu');
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      // Unlock pointer so user can click menu
      if (document.pointerLockElement) controls.unlock();
    }
  }
  // L key toggles lights (restore/dim) — handy when a trailer ends and lights don't resume
  if (e.code === 'KeyL') {
    window.__lightsOn = !window.__lightsOn;
    // Store floor orig if we haven't yet
    if (window.__floorOrigHex === undefined) window.__floorOrigHex = floorMat.color.getHex();
    // Store ceiling orig if we haven't yet
    if (!window.__ceilingOrigColors) {
      window.__ceilingOrigColors = [];
      ceiling.traverse(child => {
        if (child.isMesh && child.material && child.material.color) {
          window.__ceilingOrigColors.push({ mesh: child, hex: child.material.color.getHex() });
        }
      });
    }
    // Store poster orig if we haven't yet
    if (!window.__posterOrigColors && window.__posterMats) {
      window.__posterOrigColors = window.__posterMats.map(m => ({ mat: m, hex: m.color.getHex() }));
    }
    if (window.__lightsOn) {
      ambientLight.intensity = window.__origAmbientIntensity;
      sun.intensity = window.__origSunIntensity;
      for (const entry of window.__ceilingOrigColors) {
        entry.mesh.material.color.setHex(entry.hex);
        entry.mesh.material.needsUpdate = true;
      }
      floorMat.color.setHex(window.__floorOrigHex);
      if (window.__posterOrigColors) {
        for (const entry of window.__posterOrigColors) {
          entry.mat.color.setHex(entry.hex);
          entry.mat.needsUpdate = true;
        }
      }
      log('💡 L — lights on');
    } else {
      ambientLight.intensity = 0.05;
      sun.intensity = 0.02;
      for (const entry of window.__ceilingOrigColors) {
        entry.mesh.material.color.setHex(0x222222);
        entry.mesh.material.needsUpdate = true;
      }
      floorMat.color.setHex(0x222222);
      if (window.__posterMats) {
        for (const mat of window.__posterMats) {
          mat.color.setHex(0x222222);
          mat.needsUpdate = true;
        }
      }
      log('🌑 L — lights dimmed');
    }
  }
});
const moveSpeed = 3.0;
const collisionBoxes = [];
let tapeGroup = null;
const raycaster = new THREE.Raycaster();

// ─── Floor + Closet ───────────────────────────────────────
// Load carpet texture, add grain, tile it across the floor
function makeCarpetTexture(callback) {
  const img = new Image();
  img.onload = () => {
    const SIZE = 256;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < data.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 50;
      data.data[i]     = Math.max(0, Math.min(255, data.data[i] + noise));
      data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + noise));
      data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + noise));
    }

    // Blend edges so tile seams are invisible
    // Cross-fade each edge pixel with the opposite edge pixel
    const BLEND = 128;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < BLEND; x++) {
        const t = x / BLEND;
        const li = (y * SIZE + x) * 4;
        const ri = (y * SIZE + (SIZE - 1 - x)) * 4;
        data.data[li]     = data.data[li] * t + data.data[ri] * (1 - t);
        data.data[li + 1] = data.data[li + 1] * t + data.data[ri + 1] * (1 - t);
        data.data[li + 2] = data.data[li + 2] * t + data.data[ri + 2] * (1 - t);
        data.data[ri]     = data.data[ri] * t + data.data[li] * (1 - t);
        data.data[ri + 1] = data.data[ri + 1] * t + data.data[li + 1] * (1 - t);
        data.data[ri + 2] = data.data[ri + 2] * t + data.data[li + 2] * (1 - t);
      }
    }
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < BLEND; y++) {
        const t = y / BLEND;
        const ti = (y * SIZE + x) * 4;
        const bi = ((SIZE - 1 - y) * SIZE + x) * 4;
        data.data[ti]     = data.data[ti] * t + data.data[bi] * (1 - t);
        data.data[ti + 1] = data.data[ti + 1] * t + data.data[bi + 1] * (1 - t);
        data.data[ti + 2] = data.data[ti + 2] * t + data.data[bi + 2] * (1 - t);
        data.data[bi]     = data.data[bi] * t + data.data[ti] * (1 - t);
        data.data[bi + 1] = data.data[bi + 1] * t + data.data[ti + 1] * (1 - t);
        data.data[bi + 2] = data.data[bi + 2] * t + data.data[ti + 2] * (1 - t);
      }
    }

    // Final noise wash — randomize every pixel to bury any remaining seam artifacts
    for (let i = 0; i < data.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 100;
      data.data[i]     = Math.max(0, Math.min(255, data.data[i] + n));
      data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + n));
      data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + n));
    }

    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    callback(tex);
  };
  img.src = '/assets/carpet.jpg';
}
const floorMat = new THREE.MeshBasicMaterial({ color: 0x6b5344 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
// Carpet texture loads async — swap material when ready
makeCarpetTexture((tex) => {
  floorMat.map = tex;
  floorMat.color.set(0xffffff);
  floorMat.needsUpdate = true;
});

const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
grid.position.y = 0.01;
grid.visible = false;
scene.add(grid);

const { closetGroup, bounds } = buildCloset();
scene.add(closetGroup);
collisionBoxes.push(...bounds);

// ─── Ceiling ────────────────────────────────────────────────
const ceiling = buildCeiling();
scene.add(ceiling);

// ─── Panel ─────────────────────────────────────────────────
window.closePanel = () => {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('panel-trailer-results').innerHTML = '';
  closePanel3D();
};
window.searchTrailers = async (autoPlay = false) => {
  const panel = document.getElementById('panel');
  const q = `${panel.dataset.title || ''} ${panel.dataset.year || ''} trailer`;
  console.log('🎬 Trailer search query:', q.trim());
  if (autoPlay) {
    // Use YouTube Data API to find first result
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
    if (apiKey) {
      try {
        const resp = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q.trim())}&type=video&maxResults=1&key=${apiKey}`
        );
        const data = await resp.json();
        if (data.items && data.items.length > 0) {
          const videoId = data.items[0].id.videoId;
          showProjector(videoId);
          return;
        }
      } catch (e) {
        console.warn('YouTube API search failed:', e);
      }
    }
    // Fallback: open YouTube search in new tab
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q.trim())}`, '_blank');
  } else {
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q.trim())}`, '_blank');
  }
};
window.projectDemoTrailer = () => {
  showProjector('9o7FViiDEAU');
};
window.addPick = () => {
  const panel = document.getElementById('panel');
  const filmId = panel.dataset.filmId;
  const film = getFilm(filmId);
  if (!film) return;
  addPick(film);
};

// ─── Collision ─────────────────────────────────────────────
function collides(pos) {
  const r = 0.3;
  for (const box of collisionBoxes) {
    if (pos.x + r > box.min.x && pos.x - r < box.max.x &&
        pos.z + r > box.min.z && pos.z - r < box.max.z &&
        pos.y > box.min.y && pos.y < box.max.y) return true;
  }
  return false;
}

// ─── Layout init ───────────────────────────────────────────
function log(msg) {
  document.getElementById('info').textContent = msg;
  console.log(msg);
}

// ─── Doom-style screen wipe ──────────────────────────────
function doomWipe(callback) {
  // Legacy: melt to black, capture current screen via WebGL readPixels
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(RT_W * RT_H * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, RT_W, RT_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const c = document.createElement('canvas');
  c.width = RT_W;
  c.height = RT_H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(RT_W, RT_H);
  const buf = new Uint32Array(img.data.buffer);
  for (let y = 0; y < RT_H; y++) {
    const srcRow = (RT_H - 1 - y) * RT_W;
    for (let x = 0; x < RT_W; x++) buf[y * RT_W + x] = new Uint32Array(pixels.buffer)[srcRow + x];
  }
  img.data.set(new Uint8Array(buf.buffer));
  ctx.putImageData(img, 0, 0);
  doomWipeWithDest(c, c, callback);
}

function doomWipeWithDest(startCanvas, destCanvas, callback) {
  const canvas = document.getElementById('wipe-canvas');
  const ctx = canvas.getContext('2d');
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  canvas.style.display = 'block';

  // Source canvases are PSX-sized (320×240 from doSort)
  // Use them directly, then upscale 2×
  const W2 = startCanvas.width;
  const H2 = startCanvas.height;

  const startData = startCanvas.getContext('2d').getImageData(0, 0, W2, H2);
  const endData = destCanvas.getContext('2d').getImageData(0, 0, W2, H2);
  const startPixels = new Uint32Array(startData.data.buffer);
  const endPixels = new Uint32Array(endData.data.buffer);

  // Column-major
  const startCol = new Uint32Array(W2 * H2);
  const endCol = new Uint32Array(W2 * H2);
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      startCol[x * H2 + y] = startPixels[y * W2 + x];
      endCol[x * H2 + y] = endPixels[y * W2 + x];
    }
  }

  // Working buffer (row-major)
  const outPixels = new Uint32Array(startPixels);

  // Column offsets
  const y = new Int32Array(W2);
  y[0] = -(Math.floor(Math.random() * 16));
  for (let i = 1; i < W2; i++) {
    const r = (Math.floor(Math.random() * 3)) - 1;
    y[i] = y[i - 1] + r;
    if (y[i] > 0) y[i] = 0;
    else if (y[i] === -16) y[i] = -15;
  }

  const TICKS_PER_FRAME = 1;

  function wipeStep() {
    let done = true;
    for (let t = 0; t < TICKS_PER_FRAME; t++) {
      for (let i = 0; i < W2; i++) {
        if (y[i] < 0) { y[i]++; done = false; }
        else if (y[i] < H2) {
          const dy = (y[i] < 16) ? y[i] + 1 : 8;
          const cappedDy = (y[i] + dy >= H2) ? H2 - y[i] : dy;
          if (cappedDy > 0) {
            for (let j = 0; j < cappedDy; j++)
              outPixels[(y[i] + j) * W2 + i] = endCol[i * H2 + y[i] + j];
            y[i] += cappedDy;
          }
          const remaining = H2 - y[i];
          if (remaining > 0)
            for (let j = 0; j < remaining; j++)
              outPixels[(y[i] + j) * W2 + i] = startCol[i * H2 + j];
          done = false;
        }
      }
    }

    // Upscale 2× to fill screen
    const imgData = ctx.createImageData(W, H);
    const fullBuf = new Uint32Array(imgData.data.buffer);
    const scaleX = W / W2;
    const scaleY = H / H2;
    for (let y = 0; y < H; y++) {
      const srcY = Math.floor(y / scaleY);
      for (let x = 0; x < W; x++) {
        fullBuf[y * W + x] = outPixels[srcY * W2 + Math.floor(x / scaleX)];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    if (!done) requestAnimationFrame(wipeStep);
    else { canvas.style.display = 'none'; callback(); }
  }

  wipeStep();
}

function undoWipe() {
  const canvas = document.getElementById('wipe-canvas');
  canvas.style.display = 'none';
}

// ─── Sort handler ────────────────────────────────────────
let currentSortKey = 'spine';

async function doSort(sortKey) {
  const sortNames = { spine: 'Spine #', year: 'Year', director: 'Director', country: 'Country', color: 'Color 🌈' };
  currentSortKey = sortKey;
  document.getElementById('sort-current').textContent = 'Current: ' + sortNames[sortKey];
  document.getElementById('sort-menu').style.display = 'none';

  if (!_cachedLayout) { wipePaused = false; return; }
  const { films, date, layout } = _cachedLayout;

  // Freeze controls during wipe
  for (const k in keys) keys[k] = false;
  wipePaused = true;

  // For color sort, compute colors first (async)
  if (sortKey === 'color' && !window.__filmColorsComputed) {
    log('Computing cover colors...');
    await computeFilmColors(films);
    window.__filmColorsComputed = true;
  }

  doSortInner(sortKey, films, date, layout);
}

function doSortInner(sortKey, films, date, layout) {
  const sortNames = { spine: 'Spine #', year: 'Year', director: 'Director', country: 'Country', color: 'Color 🌈' };

  // Snapshot the current scene — render to the PSX render target and read pixels from there
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const startPixels = new Uint8Array(RT_W * RT_H * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, RT_W, RT_H, gl.RGBA, gl.UNSIGNED_BYTE, startPixels);

  // Build a canvas from the render target pixels (flip Y)
  const startCanvas = document.createElement('canvas');
  startCanvas.width = RT_W;
  startCanvas.height = RT_H;
  const startCtx = startCanvas.getContext('2d');
  const startImg = startCtx.createImageData(RT_W, RT_H);
  const startBuf = new Uint32Array(startImg.data.buffer);
  for (let y = 0; y < RT_H; y++) {
    const srcRow = (RT_H - 1 - y) * RT_W;
    for (let x = 0; x < RT_W; x++) {
      startBuf[y * RT_W + x] = new Uint32Array(startPixels.buffer)[srcRow + x];
    }
  }
  startImg.data.set(new Uint8Array(startBuf.buffer));
  startCtx.putImageData(startImg, 0, 0);

  // Remove old tapes
  if (tapeGroup) {
    scene.remove(tapeGroup);
    tapeGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    tapeGroup = null;
  }

  // Build new tapes with sort order
  const packed = packShelves(layout, films, date, sortKey);
  log(`Sorting by ${sortNames[sortKey]}... ${packed.tapes.length} tapes`);

  // Add new tapes, snap to spawn, then render for end-screen snapshot
  const newMesh = buildTapes(packed, scene);
  tapeGroup = newMesh.mesh;
  camera.position.set(0.95, 1.6, -8.5);
  camera.rotation.set(0, Math.PI, 0);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const endPixels = new Uint8Array(RT_W * RT_H * 4);
  gl.readPixels(0, 0, RT_W, RT_H, gl.RGBA, gl.UNSIGNED_BYTE, endPixels);

  // Build end canvas at PSX resolution
  const endCanvas = document.createElement('canvas');
  endCanvas.width = RT_W;
  endCanvas.height = RT_H;
  const endCtx = endCanvas.getContext('2d');
  const endImg = endCtx.createImageData(RT_W, RT_H);
  const endBuf = new Uint32Array(endImg.data.buffer);
  for (let y = 0; y < RT_H; y++) {
    const srcRow = (RT_H - 1 - y) * RT_W;
    for (let x = 0; x < RT_W; x++) {
      endBuf[y * RT_W + x] = new Uint32Array(endPixels.buffer)[srcRow + x];
    }
  }
  endImg.data.set(new Uint8Array(endBuf.buffer));
  endCtx.putImageData(endImg, 0, 0);

  // Remove new tapes (will be re-added after wipe completes)
  scene.remove(tapeGroup);
  tapeGroup = null;

  // Doom melt from start → end
  doomWipeWithDest(startCanvas, endCanvas, () => {
    // After wipe: re-add tapes, then force a clean first-frame render
    const result = buildTapes(packed, scene);
    tapeGroup = result.mesh;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(fullScreen, fullCamera);
    wipePaused = false;
    log(`Sorted by ${sortNames[sortKey]} — ${films.length} films`);
  });
}

// Wire sort menu options
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.sort-option');
  if (opt) {
    doSort(opt.dataset.sort);
  }
});

async function init() {
  log('Loading assets...');
  await Promise.all([loadFilms(), loadAtlases()]);
  
  const films = getFilms();
  const date = getTodayDate();
  const seed = generateSeed(date);
  
  log(`${films.length} films loaded · allocating copies...`);
  const layout = allocateCopies(films, date, 0.90);
  
  log(`Allocated ${layout.totalTapes} copies across ${layout.usedSlots}/${layout.capacity} slots (${(layout.usedSlots/layout.capacity*100).toFixed(0)}%)...`);
  
  log('Packing shelves...');
  const packed = packShelves(layout, films, date);
  
  recordLayout(date, seed, layout);
  
  log(`Building ${packed.tapes.length} tape geometries...`);
  const result = buildTapes(packed, scene);
  tapeGroup = result.mesh;

  // Place movie posters on entrance walls
  placeMoviePosters(films, scene);

  log(`Ready! ${films.length} films · ${layout.totalTapes} tapes · ${(layout.usedSlots/layout.capacity*100).toFixed(0)}% fill · click tapes to inspect`);

  // Store layout for rebuild / sort
  _cachedLayout = { films, date, layout };
  // Also store for tuning panel if available
  if (window.__C) window.__C._layout = layout;

  // Init Picks (empty hand, session-only)
  initPicks();

  // Init 3D panel scene (lazy — canvas sizes on first panel open)
  initPanel3D();

  // Title card: hide the canvas until the melt finishes
  const titleCard = document.getElementById('title-card');
  const mainCanvas = document.querySelector('canvas');
  if (titleCard) {
    // Keep title card visible, hide the 3D canvas underneath
    mainCanvas.style.display = 'none';
    // Wait for the image to load, then 3 seconds total hold
    const titleImg = document.getElementById('title-img');
    const doMelt = () => {
      // Snapshot the title card image at PSX resolution
      const startCanvas = document.createElement('canvas');
      startCanvas.width = RT_W;
      startCanvas.height = RT_H;
      const sctx = startCanvas.getContext('2d');
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(titleImg, 0, 0, RT_W, RT_H);

      // Snapshot the 3D scene as end
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      const endPixels = new Uint8Array(RT_W * RT_H * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, RT_W, RT_H, gl.RGBA, gl.UNSIGNED_BYTE, endPixels);
      const endCanvas = document.createElement('canvas');
      endCanvas.width = RT_W;
      endCanvas.height = RT_H;
      const ectx = endCanvas.getContext('2d');
      const eImg = ectx.createImageData(RT_W, RT_H);
      const eBuf = new Uint32Array(eImg.data.buffer);
      for (let y = 0; y < RT_H; y++) {
        const srcRow = (RT_H - 1 - y) * RT_W;
        for (let x = 0; x < RT_W; x++) eBuf[y * RT_W + x] = new Uint32Array(endPixels.buffer)[srcRow + x];
      }
      eImg.data.set(new Uint8Array(eBuf.buffer));
      ectx.putImageData(eImg, 0, 0);

      // Show main canvas and hide title card
      mainCanvas.style.display = 'block';
      titleCard.classList.add('hidden');

      // Melt from title card into closet
      doomWipeWithDest(startCanvas, endCanvas, () => {
        // Done
      });
    };
    // If img already loaded, just go, otherwise wait for load
    if (titleImg.complete) {
      setTimeout(doMelt, 3000);
    } else {
      titleImg.onload = () => setTimeout(doMelt, 3000);
    }
  }
}

// ─── Rebuild (for tuning panel) ──────────────────────────
let _cachedLayout = null;
const _origInit = init;
init = async function() {
  await _origInit();
  // Store layout for rebuild
  if (window.__C) {
    const films = getFilms();
    const date = getTodayDate();
    _cachedLayout = { films, date, layout: allocateCopies(films, date, window.__C.fillTarget || 0.90) };
  }
};
window.__rebuildTapes = () => {
  if (!_cachedLayout) return;
  const { films, date, layout } = _cachedLayout;
  // Remove old tapes
  if (tapeGroup) {
    scene.remove(tapeGroup);
    tapeGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    tapeGroup = null;
  }
  // Re-pack with current config
  const packed = packShelves(layout, films, date);
  log(`Rebuilding ${packed.tapes.length} tapes with tuning config...`);
  const result = buildTapes(packed, scene);
  tapeGroup = result.mesh;
  log('Rebuild done.');
};

// ─── Raycast interaction (simple: center crosshair click) ──
document.addEventListener('click', (e) => {
  if (!document.pointerLockElement) return;
  if (!tapeGroup) return;
  
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  // Only check direct children — merged meshes per sheet
  const hits = raycaster.intersectObjects(tapeGroup.children, false);
  if (hits.length === 0) return;
  
  // We hit a merged sheet. Figure out which tape by triangle index.
  // Each tape = 2 triangles = 6 indices. tapeIndex = faceIndex / 2.
  // Store tape metadata in mesh.userData by sheet.
  const mesh = hits[0].object;
  if (!mesh.userData.tapeIds) return;
  
  const trisPerTape = mesh.userData.trisPerTape || 2;
  const faceIdx = hits[0].faceIndex;
  const tapeIdx = Math.floor(faceIdx / trisPerTape);
  const filmId = mesh.userData.tapeIds[tapeIdx];
  const film = getFilm(filmId);
  if (!film) return;
  
  // Debug: log what was hit
  console.log('CLICKED tapeIdx=' + tapeIdx + ' → ' + film.id + ' (' + film.title + ')');
  
  const panel = document.getElementById('panel');
  panel.style.display = 'block';
  panel.dataset.title = film.title;
  panel.dataset.year = film.year || '';
  panel.dataset.filmId = film.id;
  showFilm3D(film.id, `/assets/covers/${film.id}.jpg`);
  document.getElementById('panel-meta').innerHTML = [
    film.spine ? `<strong>Spine:</strong> #${film.spine}<br>` : '',
    `<strong>Title:</strong> ${film.title}<br>`,
    film.year ? `<strong>Year:</strong> ${film.year}<br>` : '',
    film.director ? `<strong>Director:</strong> ${film.director}<br>` : '',
    film.country ? `<strong>Country:</strong> ${film.country}<br>` : '',
  ].join('');
  document.getElementById('panel-trailer-results').innerHTML = '';
  // Update Add to Picks button
  renderPicks(); // refreshes button state via updateAddButtonState
  controls.unlock();
});

// ─── Render loop ───────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  if (wipePaused) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  
  if (document.pointerLockElement) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    
    const vel = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) vel.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) vel.sub(forward);
    if (keys['KeyA'] || keys['ArrowLeft']) vel.sub(right);
    if (keys['KeyD'] || keys['ArrowRight']) vel.add(right);
    vel.normalize();
    
    // Crouch (C key toggle)
    const speedMul = crouching ? 0.5 : 1.0;
    vel.multiplyScalar(moveSpeed * speedMul * dt);
    
    // Zoom (Shift) — scale FOV from 45 to ~22.5 for 2x zoom
    const targetFov = keys['ShiftLeft'] || keys['ShiftRight'] ? 22.5 : 45;
    camera.fov += (targetFov - camera.fov) * 0.15;
    camera.updateProjectionMatrix();
    
    const newPos = camera.position.clone().add(vel);
    newPos.y = crouching ? 1.0 : 1.6;
    if (!collides(newPos)) camera.position.copy(newPos);
  }
  
  // PSX: render scene to low-res target, then blit to canvas
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(fullScreen, fullCamera);

  // CSS3D overlay (YouTube trailer projector)
  if (projectorActive && cssRenderer) {
    cssRenderer.render(scene, camera);
  }

  // Hover caption
  if (document.pointerLockElement && tapeGroup) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = rc.intersectObjects(tapeGroup.children, false)[0];
    const cap = document.getElementById('caption');
    if (hit && hit.object?.userData.tapeIds) {
      const tpt = hit.object.userData.trisPerTape || 2;
      const film = getFilm(hit.object.userData.tapeIds[Math.floor(hit.faceIndex / tpt)]);
      if (film) { cap.textContent = `${film.title}  (${film.year || ''})`; cap.style.display = 'block'; }
      else { cap.style.display = 'none'; }
    } else { cap.style.display = 'none'; }
  }
}

// ─── Bootstrap ──────────────────────────────────────────
(async () => {
  const ok = await ensureAssets();
  if (ok) {
    init().then(() => animate());
  }
})();