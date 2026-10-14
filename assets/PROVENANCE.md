# PWA assets provenance (phase 1)

## Open Sans

Unmodified normal WOFF2 subsets (Latin, Latin extended, Cyrillic), weights
400/600/700, from `@fontsource/open-sans@5.3.0`:
https://registry.npmjs.org/@fontsource/open-sans/-/open-sans-5.3.0.tgz

Package integrity verified before extraction:
`sha512-V1bdMlGNyZrJwzrdusshMOw2YR0aqYDL7kOo9dkxUEKl8dFv66A9HLckOOXl572sG/7ohhDQrCrTFGSn9LZcSw==`.
Archive SHA-256: `95e6dd90f5860d0de22f791b6d802598743762c62e4894bfa26f80b1ea0cf3f5`.
Files taken from `package/files/open-sans-{subset}-{weight}-normal.woff2`.
Unicode ranges in `app/layout.css` are from package CSS. No variable/synthetic
weight replaces the required static faces. Symbols outside these subsets use
the existing Helvetica/sans-serif fallback.

Copyright 2020 The Open Sans Project Authors. SIL OFL 1.1 retained verbatim
in [fonts/open-sans/LICENSE](fonts/open-sans/LICENSE); upstream package metadata
retained in [fonts/open-sans/metadata.json](fonts/open-sans/metadata.json).
Obtain the exact archive above, verify its integrity, and extract those nine
WOFF2 files plus LICENSE/metadata.json to reproduce acquisition. No runtime CDN
or npm font dependency is added.

## Icons

Owner directed reuse of assets from `D:/work/js-games/ua-dream/tilecraft`.
Inspected `images/icons/icon-733-maskable.png` (733×733 RGBA) and `icon-512.png`
(512×512 RGBA): blue calligraphic monogram/brush circle, transparent background.
The padded 733px file is copied byte-for-byte to `icons/master-733.png`.
SHA-256: `725ac9836dd734c49a7753777316cc273a5bfc50a8f632ddc61c2baf937b9003`.
Its nontransparent foreground fits a 272px radius, inside the maskable safe
circle of radius 293.2px (40% of 733). This is not a 64px favicon upscale.

Generate all five output files from this master with:

```sh
python debug/generate-pwa-icons.py
```

Requires Python and Pillow (`uv run --with pillow python debug/generate-pwa-icons.py`
is an alternative when Pillow is not installed). Composite onto opaque `#202024`,
then Lanczos-downsample to 192/512 any, 192/512 maskable, and 180 apple touch.
Any and maskable share padded artwork deliberately; separate entries declare
purposes explicitly. No name or Android application link from Tilecraft's
manifest is retained. Master/source art ownership remains with its existing
owner; reuse is owner-directed, not a claim of a new open-source art license.
The existing Fluid Paint 64px favicon is unchanged.
Original painting attribution is preserved in the footer as text, without
cross-origin HTML links: https://david.li and https://github.com/dli/paint.
The root MIT LICENSE remains unchanged.
