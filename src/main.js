import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildCloset, buildCeiling } from './closet.js';
import { generateSeed, getTodayDate } from './seed.js';
import { allocateCopies, packShelves } from './layout.js';
import { recordLayout, loadHistory } from './history.js';
import { loadAtlases, loadFilms, getFilm, getFilms, buildTapes } from './tapes.js';
import { showFilm3D, closePanel3D, initPanel3D } from './panel3d.js';
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

// ─── Scene ────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.fog = new THREE.Fog(0x1a1a1a, 8, 25);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 30);
camera.position.set(2, 1.6, 0);
camera.rotation.set(0, 0, 0); // face +Z direction (down the aisle)

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
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 0.25);
sun.position.set(0, 8, 5);
scene.add(sun);

// ─── State ─────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => keys[e.code] = true);
document.addEventListener('keyup', e => keys[e.code] = false);
// Q key toggles between PSX low-res and full resolution
let hires = false;
window.__hires = hires;
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
window.searchTrailers = () => {
  const panel = document.getElementById('panel');
  const q = `${panel.dataset.title || ''} ${panel.dataset.year || ''} trailer`;
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q.trim())}`, '_blank');
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
  
  log(`Ready! ${films.length} films · ${layout.totalTapes} tapes · ${(layout.usedSlots/layout.capacity*100).toFixed(0)}% fill · click tapes to inspect`);

  // Init 3D panel scene (lazy — canvas sizes on first panel open)
  initPanel3D();
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
  showFilm3D(film.id, `/assets/covers/${film.id}.jpg`);
  document.getElementById('panel-meta').innerHTML = [
    film.spine ? `<strong>Spine:</strong> #${film.spine}<br>` : '',
    `<strong>Title:</strong> ${film.title}<br>`,
    film.year ? `<strong>Year:</strong> ${film.year}<br>` : '',
    film.director ? `<strong>Director:</strong> ${film.director}<br>` : '',
    film.country ? `<strong>Country:</strong> ${film.country}<br>` : '',
  ].join('');
  document.getElementById('panel-trailer-results').innerHTML = '';
  controls.unlock();
});

// ─── Render loop ───────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
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
    
    // Crouch (C key) — half speed
    const speedMul = keys['KeyC'] ? 0.5 : 1.0;
    vel.multiplyScalar(moveSpeed * speedMul * dt);
    
    // Zoom (Shift) — scale FOV from 45 to ~22.5 for 2x zoom
    const targetFov = keys['ShiftLeft'] || keys['ShiftRight'] ? 22.5 : 45;
    camera.fov += (targetFov - camera.fov) * 0.15;
    camera.updateProjectionMatrix();
    
    const newPos = camera.position.clone().add(vel);
    newPos.y = keys['KeyC'] ? 1.0 : 1.6;
    if (!collides(newPos)) camera.position.copy(newPos);
  }
  
  // PSX: render scene to low-res target, then blit to canvas
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(fullScreen, fullCamera);

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

init().then(() => animate());