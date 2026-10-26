# Tilecraft test fixtures

## `tilecraft-spot-parity.json`

A minimal slice of a real Tilecraft export, kept for the spot-parity work in
`docs/TILECRAFT-SPOT-PARITY-SPEC.md`.

**Origin:** `C:/Users/cergi/Downloads/origin.json`, received 2026-10-21 in the
discussion that opened that specification. The full model held 963 tiles across
four visible layers (`polygon` 350, `polyline` 186, `square` 250, `circle` 177)
and two frames.

**What was kept.** One whole group per layer, plus a second `polygon` group, so
that both characteristic group scales survive:

| Layer | `tileShape` | `g` | Tiles | `gridSize` | `gd` | `dist` | `F` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Background | `polygon` | 6 | 74 | 20 | 65,25 | 120,46 | 1,8462 |
| Background | `polygon` | 9 | 55 | 20 | 75,8 | 129,26 | 1,7053 |
| Foreground | `polyline` | 1 | 40 | 3 | 43,32 | 79,98 | 1,8463 |
| Timeline | `square` | 11 | 42 | 15 | 404 | 688,87 | 1,7051 |
| (no tag) | `circle` | 17 | 44 | 15 | 125 | 213,20 | 1,7056 |

Groups are kept whole and in source order, so `gd`, the `firstTile`/`lastTile`
distance and the `b` breaks all reproduce the source renderer's grouping.
`layer.opacity = 125` is preserved on the `polygon` layer.

**What was removed.** Frame `_frameCollabId` and `selected` (collab session
identity, not geometry) and the `background`/`backgroundIdx` raster reference.
Nothing inside `layers[].tiles[]` was altered.

**What this fixture cannot cover**, per §1 of the specification — these need
their own synthetic fixtures:

- `fit` is absent, so only the `bounds` + `scale` fallback path is exercised.
- no tile carries `tile.a` (0 of 963 in the source), so per-tile alpha is not
  testable here.
- every group carries exactly two tiles with `gd > 0` and they agree, so a
  group with *differing* per-tile `gd` is not represented.
- no group reaches the `0,1` lower bound of `tileFrameScale()`.
