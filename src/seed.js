// FNV-1a 32-bit hash — deterministic, reproducible
export function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash = hash >>> 0;
  }
  return hash;
}

// Get today's date string YYYY-MM-DD
export function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Generate seed from date
export function generateSeed(date) {
  return fnv1a(date);
}

// Mulberry32 PRNG — fast, good distribution
export function mulberry32(seed) {
  let state = seed;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Create a seeded RNG from a date string
export function createRng(date) {
  return mulberry32(generateSeed(date));
}