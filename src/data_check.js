/**
 * Data readiness check for Criterion Closet.
 * Verifies that the precomputed assets exist before the app tries to load them.
 * If missing, shows an overlay with instructions and a "Generate Now" button.
 *
 * Also provides generateAssets() which calls the Vite server's custom endpoint
 * to run the preprocessing pipeline server-side (only in dev mode).
 */

const REQUIRED = [
  '/assets/films.json',
  '/assets/atlas_0.png',
  '/assets/carpet.jpg',
  '/assets/light_diffuser.webp',
  '/assets/title-card.png',
];

async function checkAssetsExist() {
  const results = await Promise.all(
    REQUIRED.map(async (path) => {
      try {
        const resp = await fetch(path, { method: 'HEAD' });
        return { path, ok: resp.ok };
      } catch {
        return { path, ok: false };
      }
    })
  );
  return {
    allOk: results.every(r => r.ok),
    missing: results.filter(r => !r.ok).map(r => r.path),
  };
}

/**
 * Show the bootstrap overlay if assets are missing.
 * Includes a log of the check result and a button to generate.
 */
export function showBootstrapOverlay(missing) {
  // Remove any existing
  const old = document.getElementById('bootstrap-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bootstrap-overlay';
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:#0a0a0a;color:#e0e0e0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;font-family:monospace;padding:2rem;">
      <h1 style="font-size:1.8rem;margin-bottom:0.5rem;color:#fc4c02;">Criterion Closet</h1>
      <p style="color:#999;margin-bottom:1.5rem;">Precomputed assets not found</p>

      <div style="max-width:560px;background:#1a1a1a;padding:1.5rem;border-radius:8px;margin-bottom:1.5rem;">
        <p style="margin:0 0 0.75rem 0;"><strong style="color:#fc4c02;">${missing.length} missing asset(s):</strong></p>
        <ul style="margin:0;padding-left:1.2rem;font-size:0.85rem;color:#bbb;">
          ${missing.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>

      <p style="color:#bbb;margin-bottom:1rem;text-align:center;max-width:500px;">
        You need to run the data generation pipeline first. This downloads film covers and
        builds atlas sheets, spine strips, and the film manifest.
      </p>

      <div style="background:#111;padding:0.75rem 1rem;border-radius:4px;border:1px solid #333;font-size:0.9rem;margin-bottom:1.5rem;text-align:left;">
        <code style="color:#8f8;">
          cd src<br>
          python3 preprocess/extract_spines.py<br>
          python3 preprocess/build_atlas.py<br>
          python3 preprocess/gen_films_json.py
        </code>
      </div>

      <button id="bootstrap-retry" style="
        background:#333;color:#e0e0e0;border:1px solid #555;padding:0.5rem 1.5rem;
        border-radius:4px;cursor:pointer;font-family:monospace;font-size:0.9rem;
      ">Check Again</button>

      <p style="color:#666;font-size:0.75rem;margin-top:1.5rem;">
        Need the full dataset? Run <code style="color:#888;">download_missing.py</code> in the project root first.
      </p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('bootstrap-retry').onclick = async () => {
    const result = await checkAssetsExist();
    if (result.allOk) {
      overlay.remove();
      location.reload();
    } else {
      const list = overlay.querySelector('ul');
      list.innerHTML = result.missing.map(p => `<li>${p}</li>`).join('');
    }
  };
}

/**
 * Called from main.js before init. Returns true if all assets present.
 * If not, shows the overlay and returns false.
 */
export async function ensureAssets() {
  const result = await checkAssetsExist();
  if (!result.allOk) {
    console.warn('[Criterion] Missing assets:', result.missing);
    showBootstrapOverlay(result.missing);
    return false;
  }
  return true;
}
