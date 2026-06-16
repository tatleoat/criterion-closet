import { createRng, generateSeed } from './seed.js';

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

export function packShelves(layout, films, date) {
  const copies = layout.copies;

  const tapes = [];
  for (const f of films) {
    for (let i = 0; i < copies[f.id]; i++) {
      tapes.push({ filmId: f.id, width: f.isBoxset ? 2 : 1, leaning: false });
    }
  }
  const filmLookup = {};
  for (const f of films) filmLookup[f.id] = f;
  tapes.sort((a, b) => {
    const sa = filmLookup[a.filmId]?.spine ?? 9999;
    const sb = filmLookup[b.filmId]?.spine ?? 9999;
    return sa - sb;
  });

  const shelves = Array.from({ length: TOTAL_SHELVES }, () => ({ used: 0, tapes: [] }));
  const CASE_COUNT = TOTAL_SHELVES / SHELVES_PER_CASE;
  const rng = createRng(date);
  const cfg = window.__C || {};
  const jitter = cfg.slotJitter !== undefined ? cfg.slotJitter : 0.002;
  const gapMin = cfg.groupGapMin !== undefined ? cfg.groupGapMin : 0.5;
  const gapMax = cfg.groupGapMax !== undefined ? cfg.groupGapMax : 0.75;

  // Round-robin: fill shelf 0 of all cases, then shelf 1, etc.
  // This ensures every case gets tapes even at lower fill ratios.
  let tapeIdx = 0;
  for (let shelfInCase = 0; shelfInCase < SHELVES_PER_CASE && tapeIdx < tapes.length; shelfInCase++) {
    for (let caseIdx = 0; caseIdx < CASE_COUNT && tapeIdx < tapes.length; caseIdx++) {
      const shelfIdx = caseIdx * SHELVES_PER_CASE + shelfInCase;
      const shelf = shelves[shelfIdx];
      while (tapeIdx < tapes.length && shelf.used + tapes[tapeIdx].width <= SHELF_CAPACITY) {
        const tape = tapes[tapeIdx];
        tape.shelfIndex = shelfIdx;
        tape.slotIndex = shelf.used;
        tape.caseIndex = caseIdx;
        tape.shelfInCase = shelfInCase;
        shelf.tapes.push(tape);
        shelf.used += tape.width * 0.63;
        tapeIdx++;

        // Add a tiny margin before next film group
        if (tapeIdx < tapes.length) {
          const nextTape = tapes[tapeIdx];
          if (nextTape.filmId !== tape.filmId) {
            const gap = gapMin + rng() * (gapMax - gapMin);
            if (shelf.used + nextTape.width + gap <= SHELF_CAPACITY) {
              shelf.used += gap;
            }
          }
        }
      }
    }
  }

  // Leaning detection — a few tapes per shelf tilt slightly
  for (const shelf of shelves) {
    if (shelf.tapes.length === 0) continue;
    // 1-3 leaning tapes per shelf (or 0), only at group boundaries
    const leanCount = rng() < 0.3 ? 0 : Math.max(1, Math.min(3, Math.floor(shelf.tapes.length / 8)));
    for (let l = 0; l < leanCount; l++) {
      const j = Math.floor(rng() * shelf.tapes.length);
      const tape = shelf.tapes[j];
      // Only lean the last tape in a group (end of a run of copies)
      const nextTape = j < shelf.tapes.length - 1 ? shelf.tapes[j + 1] : null;
      const isGroupEnd = (nextTape && nextTape.filmId !== tape.filmId) || !nextTape;
      if (isGroupEnd) {
        tape.leaning = true;
      }
    }
    // Slot jitter (anti-moiré) — every tape gets a tiny offset
    for (const tape of shelf.tapes) {
      tape.slotJitter = (rng() - 0.5) * jitter * 2;
    }
  }

  return { tapes, shelves };
}