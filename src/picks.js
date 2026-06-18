// ─── Picks (poker-hand) system ─────────────────────────────
// Up to 10 films you've picked up from the closet, displayed
// as a fan at the bottom of the screen.
// Session-only — no localStorage persistence.

const MAX_PICKS = 10;
let picks = [];

// ─── API ──────────────────────────────────────────────────

export function getPicks() {
  return picks;
}

export function addPick(film) {
  if (picks.length >= MAX_PICKS) return false;
  if (picks.some(p => p.id === film.id)) return false;
  picks.push({
    id: film.id,
    title: film.title,
    year: film.year,
    director: film.director,
    spine: film.spine,
  });
  renderPicks();
  return true;
}

export function removePick(filmId) {
  const idx = picks.findIndex(p => p.id === filmId);
  if (idx === -1) return false;
  picks.splice(idx, 1);
  renderPicks();
  return true;
}

export function isPicked(filmId) {
  return picks.some(p => p.id === filmId);
}

// ─── Low-res downscale helper ────────────────────────────
// When in PSX mode, draw the cover image to a tiny canvas
// so the browser upscales it with nearest-neighbor (blocky).

const LOW_RES_W = 30; // tiny width for PSX-style blockiness

function applyPsxQuality(img, hires) {
  if (hires) {
    // Restore original src if it was replaced
    const orig = img.dataset.origSrc;
    if (orig && img.src !== orig) {
      img.src = orig;
    }
    return;
  }

  // Already got a low-res canvas src
  if (img.src && img.src.startsWith('data:')) return;
  if (!img.complete || !img.naturalWidth) {
    // Image not loaded yet — try again when it loads
    img.addEventListener('load', () => applyPsxQuality(img, false), { once: true });
    return;
  }

  const origW = img.naturalWidth;
  const origH = img.naturalHeight;
  const lrH = Math.round(LOW_RES_W * (origH / origW));

  const canvas = document.createElement('canvas');
  canvas.width = LOW_RES_W;
  canvas.height = lrH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, LOW_RES_W, lrH);

  img.src = canvas.toDataURL();
}

// ─── Rendering ────────────────────────────────────────────

export function renderPicks() {
  const container = document.getElementById('picks-container');
  if (!container) return;

  const hires = window.__hires;

  container.innerHTML = '';

  const label = document.getElementById('picks-label');
  if (label) {
    label.textContent = `PICKS (${picks.length}/${MAX_PICKS})`;
  }

  const total = picks.length;
  for (let i = 0; i < total; i++) {
    const film = picks[i];
    const card = document.createElement('div');
    card.className = 'pick-card';
    card.dataset.id = film.id;

    // Fan spread: linear angle from -6 to +6 degrees
    const angle = total > 1 ? -6 + (i / (total - 1)) * 12 : 0;
    // Arc upward toward the middle
    const center = (total - 1) / 2;
    const distFromCenter = Math.abs(i - center);
    const yOffset = -Math.max(0, (total - 1) / 2 - distFromCenter) * 2;

    card.style.transform = `rotate(${angle}deg) translateY(${yOffset}px)`;
    card.style.zIndex = i;

    // Cover image
    const img = document.createElement('img');
    const origSrc = `/assets/covers/${film.id}.jpg`;
    img.src = origSrc;
    img.dataset.origSrc = origSrc;
    img.alt = film.title;
    img.loading = 'lazy';
    img.draggable = false;
    img.style.imageRendering = 'pixelated';

    // If PSX mode, downscale via canvas once loaded
    if (!hires) {
      applyPsxQuality(img, false);
    }

    card.appendChild(img);

    // Title overlay on hover
    const title = document.createElement('div');
    title.className = 'pick-card-title';
    title.textContent = film.title;
    card.appendChild(title);

    // Click to remove
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      removePick(film.id);
      updateAddButtonState();
    });

    container.appendChild(card);
  }

  updateAddButtonState();
}

function updateAddButtonState() {
  const btn = document.getElementById('btn-add-pick');
  const panel = document.getElementById('panel');
  if (!btn || panel.style.display !== 'block') return;
  const filmId = panel.dataset.filmId;
  if (!filmId) return;
  const picked = picks.some(p => p.id === filmId);
  const full = picks.length >= MAX_PICKS;
  if (picked) {
    btn.textContent = '✓ In Picks';
    btn.disabled = true;
    btn.className = 'picked';
  } else if (full) {
    btn.textContent = 'Picks Full (10/10)';
    btn.disabled = true;
    btn.className = 'full';
  } else {
    btn.textContent = '+ Add to Picks';
    btn.disabled = false;
    btn.className = '';
  }
}

// ─── Apply quality toggle to existing picks ──────────────

export function applyQualityToPicks() {
  const container = document.getElementById('picks-container');
  if (!container) return;
  const hires = window.__hires;
  const cards = container.querySelectorAll('.pick-card');
  cards.forEach((card) => {
    const img = card.querySelector('img');
    if (!img) return;
    applyPsxQuality(img, hires);
  });
}

// ─── Init ─────────────────────────────────────────────────

export function initPicks() {
  picks = [];
  renderPicks();
}
