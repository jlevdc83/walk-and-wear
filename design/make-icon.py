#!/usr/bin/env python3
"""Render the app icon from design/icon.html and write the PWA's PNG masters.

Same process as the Claude Apps icon handoff: the HTML draws each slot at its real
pixel size, and each node is captured rather than one master being scaled down — so
per-size values (blur radii, shadow offsets) are computed for the size they render
at, which is the whole point of building it this way.

Where this differs: Walk & Wear is a PWA, not a .app. iOS masks a home-screen icon
itself, so the Apple 824/1024 margin would land as a small icon floating inside a
box. Every cut here is full-bleed. The margined master is still rendered, as
design/master-1024.png, for anything that wants the .icns geometry later.

    python3 design/make-icon.py
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "design" / "icon.html"
ASSETS = REPO / "assets"

# What manifest.webmanifest and index.html actually reference.
SLOTS = [
    (512, ASSETS / "icon-512.png"),
    (180, ASSETS / "apple-touch-icon.png"),
    (32, ASSETS / "favicon.png"),
]


def capture(page, size, out, bleed=True):
    """Build one canvas at `size` and screenshot just that node."""
    page.evaluate(
        """([size, bleed]) => {
            document.getElementById('board').innerHTML = '';
            const node = icon(size, bleed);
            node.id = 'shot';
            document.getElementById('board').appendChild(node);
        }""",
        [size, bleed],
    )
    # omit_background so the margined master keeps its transparent corners; the
    # full-bleed cuts are opaque anyway and are unaffected by it.
    page.locator("#shot").screenshot(path=str(out), omit_background=True)
    print(f"  {out.relative_to(REPO)}  {size}x{size}")


def main():
    if not PAGE.exists():
        print(f"missing {PAGE}", file=sys.stderr)
        return 1
    ASSETS.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1400})
        page.goto(PAGE.as_uri())
        page.wait_for_timeout(300)

        print("Rendering icon...")
        for size, out in SLOTS:
            capture(page, size, out)
        capture(page, 1024, REPO / "design" / "master-1024.png", bleed=False)
        capture(page, 1024, REPO / "design" / "master-1024-bleed.png")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
