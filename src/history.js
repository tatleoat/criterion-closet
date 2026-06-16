// Seed history persistence using localStorage
const STORAGE_KEY = 'criterion-closet-seed-history';

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function recordLayout(date, seed, layout) {
  const history = loadHistory();
  const existing = history.find(h => h.date === date);
  if (existing) {
    if (!existing.firstUsed) {
      existing.firstUsed = new Date().toISOString();
    }
  } else {
    history.push({
      date,
      seed,
      firstUsed: new Date().toISOString(),
      stats: {
        usedSlots: layout.usedSlots,
        totalTapes: layout.totalTapes,
        capacity: layout.capacity,
      },
    });
  }
  saveHistory(history);
  return history;
}

export function getHistoryDates() {
  return loadHistory().map(h => h.date).sort().reverse();
}