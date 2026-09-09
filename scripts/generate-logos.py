#!/usr/bin/env python3
"""Generate Enjoy Beauty app icons from the source logo."""
from PIL import Image
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = "/Users/ak/.workbuddy/clipboard-images/clipboard-2026-09-03T12-49-25-321Z-751f7570.jpg"
OUT_DIR = os.path.join(BASE, "icons")

os.makedirs(OUT_DIR, exist_ok=True)

src = Image.open(SRC).convert("RGBA")

# Save full logo for in-app use (homepage / login)
logo_path = os.path.join(OUT_DIR, "logo.png")
src.save(logo_path)
print(f"Saved {logo_path}")


def make_square_icon(img, size, padding_ratio=0.08):
    """Create a square icon with the logo centered on a white background."""
    # White background
    icon = Image.new("RGBA", (size, size), (255, 255, 255, 255))

    # Compute resized logo maintaining aspect ratio, leaving padding
    padding = int(size * padding_ratio)
    max_w = size - 2 * padding
    max_h = size - 2 * padding

    img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)

    x = (size - img.width) // 2
    y = (size - img.height) // 2
    icon.paste(img, (x, y), img)
    return icon


for size in (192, 512):
    icon = make_square_icon(src.copy(), size)
    path = os.path.join(OUT_DIR, f"icon-{size}.png")
    icon.save(path)
    print(f"Saved {path}")
