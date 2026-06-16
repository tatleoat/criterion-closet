// ─── TUNING PANEL ─────────────────────────────────────────
// Hit P to toggle, adjust sliders, type "report" in chat when done.
// The report prints all final values for hardcoding.

// Mutable config — read by tapes.js and layout.js at build time
// Falls back to hardcoded defaults if not set
window.__C = {
  // Tape rendering
  tapeHeightMul: 0.66,    // fraction of shelfGap that a tape occupies vertically
  tapeYOffset: -0.22,     // extra Y shift (sits tape on shelf)
  tapeInset: 0,        // how far tapes protrude from case face (m)
  tapeWidthRatio: 0.616,  // tape width as fraction of SLOT_W
  tapeThickness: 0.1,    // tape depth (m)

  // Shelf geometry
  caseHeight: 2.5,        // bookcase total height (m)
  shelfCount: 9,          // shelves per case
  shelfGapExtra: 0.05,    // extra above shelfSpacing used for tape height calc

  // Layout
  slotJitter: 0.002,       // ±random offset to break moiré (m)
  groupGapMin: 0.5,        // min gap between film groups (slot-widths)
  groupGapMax: 0.75,       // max gap between film groups (slot-widths)
  fillTarget: 0.90,       // capacity fill ratio
};

// Inject debug panel into DOM
let panelVisible = false;
let panelEl = null;

export function toggleDebugPanel() {
  if (!panelEl) {
    panelEl = createPanel();
    document.body.appendChild(panelEl);
  }
  panelVisible = !panelVisible;
  panelEl.style.display = panelVisible ? 'flex' : 'none';
  if (panelVisible) refreshPanel();
}

function createPanel() {
  const el = document.createElement('div');
  el.id = 'debug-panel';
  el.style.cssText = `
    display:none; position:fixed; top:10px; left:10px; z-index:9999;
    flex-direction:column; gap:4px; background:rgba(0,0,0,0.85);
    padding:12px; border-radius:8px; font:12px monospace; color:#eee;
    max-height:95vh; overflow-y:auto; width:320px;
  `;
  el.innerHTML = `<div style="font-weight:bold;margin-bottom:6px;">🎚️ Tuning Panel  <span style="color:#888">(P to toggle, sliders auto-rebuild)</span></div>
  <div id="debug-sliders"></div>
  <button id="debug-rebuild" style="margin-top:8px;padding:6px;background:#448;color:#fff;border:none;border-radius:4px;cursor:pointer;">🔄 Rebuild Now</button>
  <button id="debug-report" style="margin-top:4px;padding:6px;background:#484;color:#fff;border:none;border-radius:4px;cursor:pointer;">📋 Report Values</button>
  `;

  el.querySelector('#debug-rebuild').onclick = () => {
    if (window.__rebuildTapes) window.__rebuildTapes();
  };
  el.querySelector('#debug-report').onclick = () => {
    printReport();
  };

  return el;
}

let rebuildTimer = null;
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (window.__rebuildTapes) window.__rebuildTapes();
  }, 300);
}

function refreshPanel() {
  const container = document.getElementById('debug-sliders');
  if (!container) return;
  container.innerHTML = '';

  const fields = [
    { key: 'tapeHeightMul', label: 'Tape Height %', step: 0.01 },
    { key: 'tapeYOffset', label: 'Tape Y Offset', step: 0.005 },
    { key: 'tapeInset', label: 'Tape Inset', step: 0.005 },
    { key: 'tapeWidthRatio', label: 'Tape Width', step: 0.005 },
    { key: 'tapeThickness', label: 'Tape Thick', step: 0.002 },
    { key: 'caseHeight', label: 'Case Height', step: 0.1 },
    { key: 'shelfGapExtra', label: 'Shelf Gap Extra', step: 0.005 },
    { key: 'slotJitter', label: 'Slot Jitter', step: 0.001 },
    { key: 'groupGapMin', label: 'Group Gap Min', step: 0.1 },
    { key: 'groupGapMax', label: 'Group Gap Max', step: 0.1 },
    { key: 'fillTarget', label: 'Fill Target', step: 0.01 },
  ];

  for (const f of fields) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const val = window.__C[f.key];
    const label = document.createElement('span');
    label.style.cssText = 'flex:0 0 112px;font-size:11px;';
    label.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = f.step;
    input.value = val;
    input.style.cssText = 'flex:1;min-width:60px;padding:2px 4px;background:#222;color:#fff;border:1px solid #555;border-radius:3px;font:11px monospace;';
    const num = document.createElement('span');
    num.style.cssText = 'flex:0 0 50px;text-align:right;font-size:11px;color:#888;';
    num.textContent = '→';
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) {
        window.__C[f.key] = v;
        scheduleRebuild();
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          window.__C[f.key] = v;
          scheduleRebuild();
        }
      }
    };
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(num);
    container.appendChild(row);
  }
}

function printReport() {
  const c = window.__C;
  const shelfSpacing = c.caseHeight / (c.shelfCount + 1);
  const shelfGap = shelfSpacing + c.shelfGapExtra;
  const tapeHeight = shelfGap * c.tapeHeightMul;
  const halfH = tapeHeight / 2;

  const report = `
═══ CRITERION CLOSET — TUNING REPORT ═══

CASE GEOMETRY
  Case Height:      ${c.caseHeight}
  Shelf Count:      ${c.shelfCount}
  Shelf Spacing:    ${shelfSpacing.toFixed(4)}  (= caseHeight / (shelfCount + 1))
  Shelf Gap (calc): ${shelfGap.toFixed(4)}  (= shelfSpacing + shelfGapExtra)

TAPE RENDERING
  Tape Height Mul:  ${c.tapeHeightMul}
  Tape Height:      ${tapeHeight.toFixed(4)}  (= shelfGap × tapeHeightMul)
  halfH:            ${halfH.toFixed(4)}
  Tape Y Offset:    ${c.tapeYOffset}
  Tape Inset:       ${c.tapeInset}
  Tape Width Ratio: ${c.tapeWidthRatio}
  Tape Thickness:   ${c.tapeThickness}

LAYOUT
  Slot Jitter:      ${c.slotJitter}
  Group Gap Min:    ${c.groupGapMin}  (slot-widths)
  Group Gap Max:    ${c.groupGapMax}  (slot-widths)
  Fill Target:      ${c.fillTarget}

HARDCODE THESE VALUES INTO THE SOURCE FILES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

closet.js:
  CASE_H = ${c.caseHeight}
  CEIL_Y = ${(c.caseHeight + 0.2).toFixed(1)}

tapes.js:
  TAPE_W = SLOT_W * ${c.tapeWidthRatio}
  TAPE_THICKNESS = ${c.tapeThickness}
  shelfSpacing = CASE_H / (SHELF_COUNT + 1)  → ${shelfSpacing.toFixed(4)}
  shelfGap = shelfSpacing + ${c.shelfGapExtra}  → ${shelfGap.toFixed(4)}
  tapeHeight = shelfGap * ${c.tapeHeightMul}  → ${tapeHeight.toFixed(4)}
  halfH = tapeHeight / 2  → ${halfH.toFixed(4)}
  centerY = shelfWorldY + halfH ${c.tapeYOffset >= 0 ? '+' : ''}${c.tapeYOffset}
  left wall faceX = cx + ${c.tapeInset}  → ${(-1.40 + c.tapeInset).toFixed(3)}
  right wall faceX = cx - ${c.tapeInset}  → ${(3.30 - c.tapeInset).toFixed(3)}
  back wall faceZ = cz - ${c.tapeInset}  → ${(4.35 - c.tapeInset).toFixed(3)}

layout.js:
  slotJitter = ±${c.slotJitter}
  groupGap = ${c.groupGapMin}–${c.groupGapMax} slot-widths
  fillTarget = ${c.fillTarget}
`;

  console.log(report);
  const info = document.getElementById('info');
  if (info) {
    info.textContent = '📋 Report printed to console!';
    info.style.display = 'block';
    setTimeout(() => { info.style.display = 'none'; }, 3000);
  }
  // Also show in a textarea so they can copy
  let ta = document.getElementById('report-textarea');
  if (!ta) {
    ta = document.createElement('textarea');
    ta.id = 'report-textarea';
    ta.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9999;width:500px;height:400px;font:11px monospace;background:#111;color:#0f0;border:1px solid #333;padding:8px;';
    document.body.appendChild(ta);
  }
  ta.value = report;
  ta.style.display = 'block';
  ta.select();
}

// Listen for P key to toggle
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleDebugPanel();
  }
});