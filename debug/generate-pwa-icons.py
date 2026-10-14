"""Regenerate PWA icons from the retained owner-directed master (Pillow)."""
from pathlib import Path
import math
from PIL import Image

icons = Path(__file__).resolve().parents[1] / 'assets' / 'icons'
master = Image.open(icons / 'master-733.png').convert('RGBA')
assert master.size == (733, 733)
radius = max(math.hypot(x + .5 - 366.5, y + .5 - 366.5)
             for y in range(733) for x in range(733)
             if master.getpixel((x, y))[3] > 0)
assert radius <= 733 * .4, 'Foreground must fit maskable safe circle'
canvas = Image.new('RGBA', master.size, '#202024')
canvas.alpha_composite(master)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512),
                   ('icon-192-maskable.png', 192), ('icon-512-maskable.png', 512),
                   ('apple-touch-icon.png', 180)]:
    canvas.convert('RGB').resize((size, size), Image.Resampling.LANCZOS).save(icons / name)
print(f'5 opaque icons generated; foreground radius {radius}px <= 293.2px safe area')
