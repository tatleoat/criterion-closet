import * as THREE from 'three';

let panelScene = null;
let panelCamera = null;
let panelRenderer = null;
let caseGroup = null;
let currentFilmId = null;
let clock = new THREE.Clock();
let animating = false;

export function initPanel3D() {
  // Just mark ready; canvas gets sized on first show
  animating = true;
  animate();
}

function ensureRenderer() {
  const canvas = document.getElementById('panel-canvas');
  if (!canvas) return;
  if (panelRenderer) return;
  panelScene = new THREE.Scene();
  panelCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  panelCamera.position.set(0, 0, 1.4);

  panelRenderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  panelRenderer.setClearColor(0x000000, 0);

  // Light it
  const al = new THREE.AmbientLight(0xffffff, 0.6);
  panelScene.add(al);
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(1, 2, 2);
  panelScene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dl2.position.set(-1, 0.5, 1);
  panelScene.add(dl2);

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide })
  );
  bg.position.z = -0.5;
  panelScene.add(bg);
}

function animate() {
  if (!animating) return;
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (caseGroup) {
    // Slow rotation
    caseGroup.rotation.y += dt * 0.8;
    // Gentle bob — 20% intensity
    caseGroup.position.y = Math.sin(performance.now() / 1200) * 0.01;
  }
  if (panelRenderer && panelScene && panelCamera) {
    const canvas = panelRenderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const hires = window.__hires;
    const resW = hires ? w * devicePixelRatio : Math.max(80, Math.floor(w * 0.3));
    const resH = hires ? h * devicePixelRatio : Math.max(60, Math.floor(h * 0.3));
    if (resW !== canvas.width || resH !== canvas.height) {
      panelRenderer.setSize(resW, resH, false);
      panelRenderer.setPixelRatio(1);
      panelCamera.aspect = w / h;
      panelCamera.updateProjectionMatrix();
    }
    // In low-res mode, CSS stretches the small canvas with nearest-neighbor
    canvas.style.imageRendering = hires ? 'auto' : 'pixelated';
    panelRenderer.render(panelScene, panelCamera);
  }
}

export function showFilm3D(filmId, coverUrl) {
  ensureRenderer();
  if (caseGroup) {
    panelScene.remove(caseGroup);
    caseGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    caseGroup = null;
  }
  currentFilmId = filmId;

  // Build a 3D jewel case
  caseGroup = new THREE.Group();

  const caseH = 0.8, caseW = 0.55, caseD = 0.08;
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });

  // Front cover — sits slightly proud of the edges
  const frontMat = new THREE.MeshStandardMaterial({ color: 0x222222, polygonOffset: true, polygonOffsetFactor: -1 });
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(caseW - 0.005, caseH - 0.005),
    frontMat
  );
  front.position.z = caseD / 2 + 0.001;
  caseGroup.add(front);

  // Load cover texture async — apply to front and back
  const loader = new THREE.TextureLoader();
  loader.load(coverUrl, (tex) => {
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    frontMat.map = tex;
    frontMat.color.set(0xffffff);
    frontMat.needsUpdate = true;
    backCoverMat.map = tex;
    backCoverMat.color.set(0xffffff);
    backCoverMat.needsUpdate = true;
  });

  // Spine (right edge) — thin strip spanning front to back
  const spineMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.005, caseH, caseD),
    spineMat
  );
  spine.position.set(caseW / 2, 0, 0);
  caseGroup.add(spine);

  // Left edge — thin strip spanning front to back
  const leftEdge = new THREE.Mesh(
    new THREE.BoxGeometry(0.005, caseH, caseD),
    shellMat
  );
  leftEdge.position.set(-caseW / 2, 0, 0);
  caseGroup.add(leftEdge);

  // Top edge
  const topEdge = new THREE.Mesh(
    new THREE.BoxGeometry(caseW, 0.005, caseD),
    shellMat
  );
  topEdge.position.set(0, caseH / 2, 0);
  caseGroup.add(topEdge);

  // Bottom edge
  const bottomEdge = new THREE.Mesh(
    new THREE.BoxGeometry(caseW, 0.005, caseD),
    shellMat
  );
  bottomEdge.position.set(0, -caseH / 2, 0);
  caseGroup.add(bottomEdge);

  // Back cover — thin box so it renders un-mirrored from behind
  const backCoverMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
  const backCover = new THREE.Mesh(
    new THREE.BoxGeometry(caseW - 0.005, caseH - 0.005, 0.002),
    backCoverMat
  );
  backCover.position.z = -caseD / 2;
  caseGroup.add(backCover);

  caseGroup.scale.set(0.765, 0.765, 0.765);
  caseGroup.position.y = 0.05;
  panelScene.add(caseGroup);

  // Size the renderer to the canvas after panel shows
  setTimeout(() => {
    const canvas = document.getElementById('panel-canvas');
    if (canvas && panelRenderer) {
      const w = canvas.clientWidth || 340;
      const h = canvas.clientHeight || 400;
      panelRenderer.setSize(w, h, false);
      if (panelCamera) {
        panelCamera.aspect = w / h;
        panelCamera.updateProjectionMatrix();
      }
    }
  }, 50);
}

export function closePanel3D() {
  if (caseGroup && panelScene) {
    panelScene.remove(caseGroup);
    caseGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    caseGroup = null;
  }
  currentFilmId = null;
}

export function stopPanel3D() {
  animating = false;
  if (panelRenderer) {
    panelRenderer.dispose();
    panelRenderer = null;
  }
  panelScene = null;
  panelCamera = null;
}