import * as THREE from 'three';

// ─── Movie posters on the entrance walls ───────────────────
// 3 posters on the left wall, 3 on the right wall, at the -Z (entrance) end.

const WALL_H = 2.7;            // from closet.js wallH
const POSTER_H = 1.6;          // poster height in scene units
const POSTER_W = POSTER_H * (2 / 3); // typical movie poster aspect ratio 2:3 → ~1.07
const POSTER_GAP = 0.6;        // gap between posters
const TOP_OFFSET = 0.4;        // distance from ceiling to top of topmost poster
const Z_START = -9.2;          // start of poster zone (near entrance at Z=-10)
const WALL_OFFSET = 0.03;      // how far posters sit off the wall plane (z-fighting fix)

// Left wall: X=-1.70, faces +X (rotated +π/2)
// Right wall: X=3.60, faces -X (rotated -π/2)

const WALLS = [
  { x: -1.70, rotY: Math.PI / 2,  face: 1  },  // left wall — plane facing +X
  { x:  3.60, rotY: -Math.PI / 2, face: -1 },  // right wall — plane facing -X
];

let posterGroup = null;

/**
 * Pick 6 random films with covers, load their textures, place posters.
 * Called once during init.
 */
export function placeMoviePosters(films, scene) {
  if (posterGroup) {
    scene.remove(posterGroup);
    posterGroup = null;
  }

  // Filter to films that have a cover image
  const withCovers = films.filter(f => f.id);

  // Shuffle and pick 6 (3 per wall)
  const shuffled = [...withCovers].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 6);
  if (picked.length < 6) return; // not enough films

  posterGroup = new THREE.Group();
  scene.add(posterGroup);

  const loader = new THREE.TextureLoader();

  for (let wallIdx = 0; wallIdx < 2; wallIdx++) {
    const wall = WALLS[wallIdx];
    for (let i = 0; i < 3; i++) {
      const film = picked[wallIdx * 3 + i];
      const zPos = Z_START + i * (POSTER_W + POSTER_GAP);

      // Push off the wall plane to eliminate z-fighting with the wall mesh
      const offset = wall.face * WALL_OFFSET;
      const xPos = wall.x + offset;

      // Vertical: top is TOP_OFFSET below ceiling, bottom is TOP_OFFSET + POSTER_H below ceiling
      const centerY = (WALL_H - TOP_OFFSET) - POSTER_H / 2;

      // ─── Frame (box geometry, renders in 3D) ─────────────
      // Thin box with the poster's dimensions + small border
      const FRAME_THICK = 0.015;
      const FRAME_WIDTH = 0.05;
      const frameMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

      // Outer frame board
      const outerW = POSTER_W + FRAME_WIDTH * 2;
      const outerH = POSTER_H + FRAME_WIDTH * 2;
      const outerFrame = new THREE.Mesh(
        new THREE.BoxGeometry(outerW, outerH, FRAME_THICK),
        frameMat
      );
      outerFrame.position.set(xPos, centerY, zPos);
      outerFrame.rotation.y = wall.rotY;
      posterGroup.add(outerFrame);

      // Inner cutout — a slightly smaller box with wall-colored material to create the bevel look
      // Actually: just use the frame as a flat border by making the poster sit on top.
      // Simpler: the frame is a thin box, poster plane sits slightly in front.

      // ─── Poster image plane ───────────────────────────────
      const posterMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      });
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(POSTER_W, POSTER_H),
        posterMat
      );
      // Sit the poster slightly in front of the frame
      poster.position.set(xPos + wall.face * 0.008, centerY, zPos);
      poster.rotation.y = wall.rotY;
      posterGroup.add(poster);

      // Track poster materials for dimming
      if (!window.__posterMats) window.__posterMats = [];
      window.__posterMats.push(posterMat);

      // Load cover texture asynchronously
      const coverUrl = `/assets/covers/${film.id}.jpg`;
      loader.load(coverUrl, (tex) => {
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        posterMat.map = tex;
        posterMat.color.set(0xffffff);
        posterMat.needsUpdate = true;
      });
    }
  }

  // Store the picked films for potential rebuild
  window.__posterFilms = picked;

  console.log(`🖼️ Placed ${picked.length} movie posters on entrance walls`);
}

/**
 * Rebuild posters with new random picks (can be called to refresh).
 */
export function rebuildPosters(films, scene) {
  placeMoviePosters(films, scene);
}