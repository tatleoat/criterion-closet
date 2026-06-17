import * as THREE from 'three';

const CASE_W = 2.1, CASE_H = 2.5, CASE_D = 0.3;
const SHELF_COUNT = 9;

// Room layout (top-down):
//
//   Z=5 ┌─────────────────┐
//       │ Case 10  Case 11 │  ← back wall (facing -Z toward entrance)
//   Z=4 │                   │
//   Z=3 │  Left wall        │  Right wall
//   Z=2 │  Cases 0-4        │  Cases 5-9
//   Z=1 │  (facing +X)      │  (facing -X)
//   Z=0 └─────────────────┘
//       X=0                X=4
//
// Hallway: 4m wide, 5m deep. User enters from bottom (Z=0).

export function buildCloset() {
  const group = new THREE.Group();
  const bounds = [];

  const caseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
  const backMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const spacing = CASE_H / (SHELF_COUNT + 1);

  function buildCase(cx, cz, rotY) {
    const cg = new THREE.Group();

    // Back panel
    const back = new THREE.Mesh(new THREE.PlaneGeometry(CASE_W - 0.1, CASE_H - 0.1), backMat);
    back.position.set(0, 0, -CASE_D / 2 + 0.01);
    cg.add(back);

    // Frame
    const frame = [new THREE.Mesh(new THREE.BoxGeometry(CASE_W, 0.04, CASE_D), caseMat)];
    frame[0].position.set(0, CASE_H/2, 0); cg.add(frame[0]);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(CASE_W, 0.04, CASE_D), caseMat);
    bot.position.set(0, -CASE_H/2, 0); cg.add(bot);
    const ls = new THREE.Mesh(new THREE.BoxGeometry(0.05, CASE_H, CASE_D), caseMat);
    ls.position.set(-CASE_W/2, 0, 0); cg.add(ls);
    const rs = new THREE.Mesh(new THREE.BoxGeometry(0.05, CASE_H, CASE_D), caseMat);
    rs.position.set(CASE_W/2, 0, 0); cg.add(rs);

    // Shelves
    for (let i = 1; i <= SHELF_COUNT; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(CASE_W - 0.02, 0.03, CASE_D - 0.02), shelfMat);
      s.position.set(0, -CASE_H/2 + i * spacing, 0);
      cg.add(s);
    }

    cg.position.set(cx, CASE_H/2, cz);
    cg.rotation.y = rotY;
    group.add(cg);

    // Collision bounds
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const hw = CASE_W/2, hd = CASE_D/2;
    const xs = [];
    const zs = [];
    for (const [lx, lz] of [[-hw,-hd],[hw,-hd],[-hw,hd],[hw,hd]]) {
      xs.push(cx + lx*cos - lz*sin);
      zs.push(cz + lx*sin + lz*cos);
    }
    bounds.push({
      min: new THREE.Vector3(Math.min(...xs) - 0.15, 0, Math.min(...zs) - 0.15),
      max: new THREE.Vector3(Math.max(...xs) + 0.15, CASE_H, Math.max(...zs) + 0.15),
    });
  }

  // ─── LEFT WALL ─────────────────────────────
  // Cases at X=-1.40, rotated 90° CCW (facing right into the aisle)
  // Shifted Z+2.9 and narrowed toward center
  for (const z of [-3.75, -1.50, 0.75, 3.00]) {
    buildCase(-1.40, z, -Math.PI / 2);
  }

  // ─── RIGHT WALL ────────────────────────────
  // Cases at X=3.30, rotated 90° CW (facing left into the aisle)
  for (const z of [-3.75, -1.50, 0.75, 3.00]) {
    buildCase(3.30, z, Math.PI / 2);
  }

  // ─── BACK WALL ─────────────────────────────
  // Two cases at Z=4.35, spaced 2.25 apart (closer together than before)
  buildCase(-0.175, 4.35, Math.PI);
  buildCase(2.075, 4.35, Math.PI);

  // ─── ROOM WALLS ────────────────────────────
  // Solid walls behind the bookcases so you can't see past them
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9, side: THREE.DoubleSide });
  const wallH = CASE_H + 0.2;
  // Left wall — behind left cases (cases at X=-1.40), extends to cover new front wall
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(26, wallH), wallMat);
  leftWall.position.set(-1.70, wallH / 2, 3.0);
  leftWall.rotation.y = Math.PI / 2;
  group.add(leftWall);
  // Right wall — behind right cases (cases at X=3.30)
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(26, wallH), wallMat);
  rightWall.position.set(3.60, wallH / 2, 3.0);
  rightWall.rotation.y = -Math.PI / 2;
  group.add(rightWall);
  // Back wall — behind back cases (cases at Z=4.35)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(6, wallH), wallMat);
  backWall.position.set(0.95, wallH / 2, 4.60);
  backWall.rotation.y = 0;
  group.add(backWall);
  // Front wall — encloses the entrance side (most -Z)
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(6, wallH), wallMat);
  frontWall.position.set(0.95, wallH / 2, -10.00);
  frontWall.rotation.y = 0;
  group.add(frontWall);

  return { closetGroup: group, bounds };
}

// ─── CEILING WITH FLUORESCENT PANELS ─────────────
// Grid of 2.1m × 2.1m tiles slightly above the bookcases (Y=2.7).
// Each tile has a white drop-ceiling panel with a fluorescent diffuser light.
export function buildCeiling() {
  const group = new THREE.Group();
  const TILE_SIZE = 2.1;
  const CEIL_Y = 2.7;
  const numCols = 4;
  const numRows = 11; // 23.1m deep — covers from Z≈-10.55 to Z≈+12.55

  // Center the grid over the room, then offset by +1 in X and +1 in Z
  const totalW = numCols * TILE_SIZE;
  const totalD = numRows * TILE_SIZE;
  const originX = -totalW / 2 + 1;
  const originZ = -totalD / 2 + 1;

  // T-bar frame material
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.3 });
  // Panel material — off-white drop ceiling tile, DoubleSide so visible from below
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8, side: THREE.DoubleSide });

  // Load the diffuser texture with a warm yellow tint
  const texLoader = new THREE.TextureLoader();
  const diffuserTex = texLoader.load('/assets/light_diffuser.webp');
  diffuserTex.minFilter = THREE.NearestFilter;
  diffuserTex.magFilter = THREE.NearestFilter;
  // Fluorescent light material — diffuser texture with warm yellow tint
  const lightMat = new THREE.MeshBasicMaterial({
    map: diffuserTex,
    color: 0xfff2d9,  // white + 15% yellow tint
    side: THREE.DoubleSide,
  });

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const cx = originX + col * TILE_SIZE + TILE_SIZE / 2;
      const cz = originZ + row * TILE_SIZE + TILE_SIZE / 2;

      // Drop ceiling panel (thin white square)
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE_SIZE - 0.06, TILE_SIZE - 0.06),
        panelMat
      );
      panel.position.set(cx, CEIL_Y, cz);
      panel.rotation.x = -Math.PI / 2;
      group.add(panel);

      // Fluorescent light — much bigger, fills most of the tile
      const light = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE_SIZE * 0.93, TILE_SIZE * 0.93),
        lightMat
      );
      light.position.set(cx, CEIL_Y - 0.01, cz);
      light.rotation.x = -Math.PI / 2;
      group.add(light);
    }
  }

  // T-bar grid — X-direction beams
  for (let row = 0; row <= numRows; row++) {
    const z = originZ + row * TILE_SIZE;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(totalW, 0.02, 0.04),
      frameMat
    );
    beam.position.set(totalW / 2 + originX, CEIL_Y - 0.01, z);
    group.add(beam);
  }

  // T-bar grid — Z-direction beams
  for (let col = 0; col <= numCols; col++) {
    const x = originX + col * TILE_SIZE;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, totalD),
      frameMat
    );
    beam.position.set(x, CEIL_Y - 0.01, totalD / 2 + originZ);
    group.add(beam);
  }

  return group;
}