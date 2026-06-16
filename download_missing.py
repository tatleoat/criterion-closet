#!/usr/bin/env python3
"""Download missing Criterion covers from the master criterion_films.json list."""
import json, os, sys, time, requests
from pathlib import Path

JSON_PATH = os.path.join(os.path.dirname(__file__), "criterion_films.json")
OUTPUT_DIR = os.path.dirname(__file__)
DELAY = 0.25
TIMEOUT = 30

def sanitize(name):
    safe = name.replace("/", " & ").replace("\\", " & ")
    safe = safe.replace(":", " -").replace("*", "").replace("?", "")
    safe = safe.replace('"', "").replace("<", "").replace(">", "").replace("|", "")
    safe = safe.strip().strip(".")
    return safe[:120] if len(safe) > 120 else safe

def main():
    with open(JSON_PATH) as f:
        films = json.load(f)

    # Build set of existing folders
    existing = set()
    for d in os.listdir(OUTPUT_DIR):
        p = os.path.join(OUTPUT_DIR, d)
        if os.path.isdir(p) and not d.startswith('.'):
            existing.add(d)

    downloaded = 0
    skipped = 0
    failed = 0
    total = len(films)

    for i, film in enumerate(films, 1):
        if film.get("is_boxset"):
            skipped += 1
            continue

        title = film.get("title", "").strip()
        img_url = film.get("image_url", "").strip()
        if not title or not img_url:
            skipped += 1
            continue

        folder = sanitize(title)
        if not folder:
            skipped += 1
            continue

        dest = os.path.join(OUTPUT_DIR, folder, "cover.jpg")
        if os.path.exists(dest) and folder in existing:
            skipped += 1
            continue

        os.makedirs(os.path.dirname(dest), exist_ok=True)

        try:
            resp = requests.get(img_url, timeout=TIMEOUT)
            if resp.status_code == 200 and len(resp.content) > 1000:
                with open(dest, "wb") as f:
                    f.write(resp.content)
                downloaded += 1
                print(f"[{i}/{total}] OK: {title}")
            else:
                failed += 1
                print(f"[{i}/{total}] FAIL (HTTP {resp.status_code}): {title}")
        except Exception as e:
            failed += 1
            print(f"[{i}/{total}] ERROR: {title} - {e}")

        if i < total:
            time.sleep(DELAY)

    print(f"\nDone! Downloaded: {downloaded}, Skipped: {skipped}, Failed: {failed}")
    return downloaded, skipped, failed

if __name__ == "__main__":
    main()