import { createRng, generateSeed } from './seed.js';
import { getColorForFilm } from './tapes.js';

const CAPACITY = Math.floor(60 * 90 / 0.63);
const SHELVES_PER_CASE = 9;
const SHELF_CAPACITY = 60;
const TOTAL_SHELVES = 10 * SHELVES_PER_CASE;
const MIN_COPIES = 3;
const MAX_COPIES = 8;

export function allocateCopies(films, date, fillTarget = 0.95) {
  const rng = createRng(date);
  const targetSlots = Math.floor(CAPACITY * fillTarget);

  const copies = {};
  let usedSlots = 0;
  for (const f of films) {
    copies[f.id] = MIN_COPIES;
    usedSlots += MIN_COPIES * (f.isBoxset ? 2 : 1);
  }

  const budget = targetSlots - usedSlots;
  let remaining = budget;

  while (remaining > 0) {
    const pool = [];
    let totalWeight = 0;
    for (const f of films) {
      if (copies[f.id] >= MAX_COPIES) continue;
      const w = f.isBoxset ? 2 : 1;
      if (w > remaining) continue;
      const weight = 8 - (copies[f.id] - MIN_COPIES) * 2;
      if (weight <= 0) continue;
      pool.push({ id: f.id, w, weight });
      totalWeight += weight;
    }
    if (pool.length === 0) break;

    let r = rng() * totalWeight;
    for (const item of pool) {
      r -= item.weight;
      if (r <= 0) { copies[item.id]++; remaining -= item.w; break; }
    }
  }

  const finalSlots = films.reduce((sum, f) => sum + copies[f.id] * (f.isBoxset ? 2 : 1), 0);
  return { copies, usedSlots: finalSlots, capacity: CAPACITY, date, seed: generateSeed(date), totalTapes: Object.values(copies).reduce((a, b) => a + b, 0) };
}

/**
 * Sort key helper — returns a numeric/string comparison value for a film
 */
function getSortValue(film, key) {
  switch (key) {
    case 'year':       return film.year ?? 9999;
    case 'country':    return (film.country ?? 'Unknown') + '-' + String(film.year ?? '').padStart(4, '0');
    case 'director':   return (film.director ?? 'Unknown') + '-' + String(film.spine ?? 9999).padStart(4, '0');
    case 'color': {
      const c = getColorForFilm(film.id);
      return c ? c.sortVal : film.spine ?? 9999;
    }
    case 'spine':
    default:           return film.spine ?? 9999;
  }
}

export function packShelves(layout, films, date, sortKey = 'spine') {
  const copies = layout.copies;

  // Build flat list of all tapes
  const tapes = [];
  for (const f of films) {
    for (let i = 0; i < copies[f.id]; i++) {
      tapes.push({ filmId: f.id, width: f.isBoxset ? 2 : 1, leaning: false });
    }
  }
  const filmLookup = {};
  for (const f of films) filmLookup[f.id] = f;
  tapes.sort((a, b) => {
    const va = getSortValue(filmLookup[a.filmId], sortKey);
    const vb = getSortValue(filmLookup[b.filmId], sortKey);
    if (va < vb) return -1;
    if (va > vb) return 1;
    // Tiebreaker: spine number
    const sa = filmLookup[a.filmId]?.spine ?? 9999;
    const sb = filmLookup[b.filmId]?.spine ?? 9999;
    return sa - sb;
  });

  const shelves = Array.from({ length: TOTAL_SHELVES }, () => ({ used: 0, tapes: [] }));
  const rng = createRng(date);
  const cfg = window.__C || {};
  const jitter = cfg.slotJitter !== undefined ? cfg.slotJitter : 0.002;
  const gapMin = cfg.groupGapMin !== undefined ? cfg.groupGapMin : 0.5;
  const gapMax = cfg.groupGapMax !== undefined ? cfg.groupGapMax : 0.75;
  const slotStep = cfg.slotStep !== undefined ? cfg.slotStep : 0.63;
  const slotPadding = cfg.slotStartPadding !== undefined ? cfg.slotStartPadding : 0; // slots to leave empty at the start of each shelf
  const slotEndPadding = cfg.slotEndPadding !== undefined ? cfg.slotEndPadding : 2; // slots to leave empty at the end of each shelf
  const EFFECTIVE_CAPACITY = SHELF_CAPACITY - slotPadding - slotEndPadding;

  // CASE ORDER — clockwise U-path as seen from the aisle, spine 1 at top-left
  // of the first left bookcase:
  //
  //   Left wall front→back:   indices 4, 5, 6, 7
  //   Back wall right→left:   indices 9, 8
  //   Right wall back→front:  indices 3, 2, 1, 0
  //
  // SHELF ORDER — bottom→top per case (reversed from physical 0=top)
  // SLOT ORDER — left→right (forward), spine 1 lands at far-left of bottom shelf

  const CASE_FILL_ORDER = [4, 5, 6, 7, 9, 8, 3, 2, 1, 0];

  let tapeIdx = 0;
  for (let fi = 0; fi < CASE_FILL_ORDER.length && tapeIdx < tapes.length; fi++) {
    const caseIdx = CASE_FILL_ORDER[fi];
    // Fill bottom shelf first (8 → 0), reversed from natural 0=top
    for (let revShelf = 0; revShelf < SHELVES_PER_CASE && tapeIdx < tapes.length; revShelf++) {
      const shelfInCase = (SHELVES_PER_CASE - 1) - revShelf;
      const shelfIdx = caseIdx * SHELVES_PER_CASE + shelfInCase;
      const shelf = shelves[shelfIdx];
      // Fill left→right (forward slot direction)
      while (tapeIdx < tapes.length) {
        const tape = tapes[tapeIdx];
        const w = tape.width;
        const spaceNeeded = w * slotStep;
        if (shelf.used + spaceNeeded > EFFECTIVE_CAPACITY) break;
        tape.shelfIndex = shelfIdx;
        tape.slotIndex = shelf.used + slotPadding;
        tape.caseIndex = caseIdx;
        tape.shelfInCase = shelfInCase;
        shelf.tapes.push(tape);
        shelf.used += spaceNeeded;
        tapeIdx++;

        // Gap between film groups
        if (tapeIdx < tapes.length) {
          const nextTape = tapes[tapeIdx];
          if (nextTape.filmId !== tape.filmId) {
            const gap = gapMin + rng() * (gapMax - gapMin);
            if (shelf.used + gap + (nextTape.width * slotStep) <= EFFECTIVE_CAPACITY) {
              shelf.used += gap;
            }
          }
        }
      }
    }
  }

  // Leaning detection
  for (const shelf of shelves) {
    if (shelf.tapes.length === 0) continue;
    const leanCount = rng() < 0.3 ? 0 : Math.max(1, Math.min(3, Math.floor(shelf.tapes.length / 8)));
    for (let l = 0; l < leanCount; l++) {
      const j = Math.floor(rng() * shelf.tapes.length);
      const tape = shelf.tapes[j];
      const nextTape = j < shelf.tapes.length - 1 ? shelf.tapes[j + 1] : null;
      const isGroupEnd = (nextTape && nextTape.filmId !== tape.filmId) || !nextTape;
      if (isGroupEnd) {
        tape.leaning = true;
      }
    }
    // Slot jitter (anti-moiré)
    for (const tape of shelf.tapes) {
      tape.slotJitter = (rng() - 0.5) * jitter * 2;
    }
  }

  return { tapes, shelves, sortKey };
}